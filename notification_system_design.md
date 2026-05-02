# campus notification system design

## stage 1 - api design & contracts

here are the main actions we need for the student dashboard and admin panel:
1. get student's notification feed (with pagination)
2. get details of one specific notification
3. mark one as read
4. mark all unread as read (quick clear)
5. get the badge count (unread total)
6. admin route to blast out a new notification

### core rest endpoints

**1. GET /api/v1/notifications**
- purpose: fetches the paginated feed
- headers: `Authorization: Bearer <token>`
- response:
  ```json
  {
    "data": [
      {
        "id": "some-uuid",
        "type": "Placement",
        "message": "you have an interview scheduled",
        "isRead": false,
        "createdAt": "2026-05-02T10:00:00Z"
      }
    ],
    "meta": { "page": 1, "limit": 20, "total": 45 }
  }
  ```

**2. GET /api/v1/notifications/:id**
- purpose: fetch single notification detail

**3. PATCH /api/v1/notifications/:id/read**
- purpose: mark single item read

**4. PATCH /api/v1/notifications/read-all**
- purpose: clear the unread badge for the current user

**5. GET /api/v1/notifications/unread-count**
- purpose: lightweight poll to get just the integer count
- response: `{ "count": 5 }`

**6. POST /api/v1/notifications** (admin only)
- purpose: trigger a new alert
- payload:
  ```json
  {
    "type": "Result",
    "message": "mid sem marks are out",
    "studentIDs": ["uuid-1", "uuid-2"] // or use "all"
  }
  ```

### real time stuff
instead of using heavy websockets, server-sent events (sse) is the way to go here. the client is only receiving data (one-way stream), so we don't need the overhead of socket.io. 
we can just expose a `GET /api/v1/notifications/stream` endpoint that returns `text/event-stream`. whenever a new notification drops, the server pushes it down that pipe.

## stage 2 - database 

i'm going with postgresql for this. notifications are highly relational (students -> notifications via a mapping table), and we need solid acid compliance so read counts don't drift.

### schema design
```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  roll_no VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE notif_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type notif_type NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE student_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, notification_id)
);

-- we definitely need these indexes at minimum
CREATE INDEX idx_sn_student_id ON student_notifications(student_id);
CREATE INDEX idx_sn_is_read ON student_notifications(is_read);
CREATE INDEX idx_sn_created_at ON student_notifications(created_at DESC);
```

### scaling it to 50k students & 5M notifications
if an admin hits "notify all", inserting 50,000 rows sequentially will lock up the db. to fix this:
1. partition the `student_notifications` table by student_id or date ranges.
2. do async batch inserts instead of waiting in the main request loop.
3. use pgbouncer for connection pooling so the db doesn't run out of connections during traffic spikes.

## stage 3 - query optimization

here's the bad query everyone writes first:
```sql
SELECT * FROM notifications 
WHERE student_id = 1042 AND is_read = false 
ORDER BY created_at DESC;
```

### why is it slow?
1. `SELECT *` pulls all columns. bad for memory/io.
2. no `LIMIT` means it could return thousands of rows.
3. without a composite index on `student_id` and `is_read`, postgres is forced to do a sequential scan over 5M rows. 
4. sorting everything in memory because of `ORDER BY` without a matching index.

### the fix: composite covering index
don't index every single column (that kills write performance and bloats storage). instead, build a targeted index for this exact read query:

```sql
CREATE INDEX idx_notifications_unread_feed 
ON notifications (student_id, is_read, created_at DESC) 
INCLUDE (message, type);
```
this creates an index scan that already has the required data (`message`, `type`) inside the index leaves.

### the optimized query
```sql
SELECT id, type, message, is_read, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = FALSE
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

## stage 4 - caching & performance

the biggest issue is 50,000 students hitting the db for notifications every time they load the dashboard.
here is my recommended setup to drop db load by 90%:

**1. redis cache for unread counts**
- the unread badge is the most requested piece of data. caching it is essential.
- use key: `notifications:unread:{student_id}` with a 60 second ttl.
- when they mark something as read, or a new notification drops, just bust that cache key.

**2. never fetch all**
- always paginate. loading 500 notifications at once on page load is a terrible idea.

**3. use the unread count endpoint**
- instead of pulling the whole list on page load, the frontend only pulls the `unread-count`. it only fetches the actual list when the user explicitly clicks the notification bell.

**4. db read replicas (future proofing)**
- if caching isn't enough, spin up a read replica for postgres. write operations go to master, and all the `SELECT` queries go to the replica.

## stage 5 - bulk notify reliability

the old code looped through 50,000 students synchronously, sending emails and saving to db in the same thread. if the email api timed out on student #20, the loop crashed and 49,980 students got nothing. bad design.

**the fix: use a message queue**
decouple the db insertion from the email sending. here is the revised pseudocode:

```text
// main route handler
function trigger_bulk_notify(student_ids, msg) {
  // 1. insert the notification to db instantly (source of truth)
  const n_id = db.insert_notification(msg);
  
  // 2. batch insert to mapping table
  db.batch_insert_student_notifications(student_ids, n_id);

  // 3. toss it in a queue, don't wait for emails to actually send
  for (let id of student_ids) {
    message_queue.push("email_tasks", { id, n_id, msg });
  }

  return { success: true, status: "queued" };
}

// background worker process
worker.listen("email_tasks", (job) => {
  try {
    send_email(job.id, job.msg);
  } catch (err) {
    // throw back to queue for a retry with exponential backoff
    throw err; 
  }
});
```

this way, an email failure doesn't crash the whole process. the queue handles retries for that specific user.

## stage 6 - priority inbox

for the priority inbox, we need to sort incoming notifications by type first (placement > result > event), and then by time.

**approach:**
- assign weights: placement = 3, result = 2, event = 1.
- calculate a composite score: `(weight * 1,000,000,000) + unix_timestamp`
- this guarantees that type always overrides the timestamp, but within the same type, newer messages score higher.

if this had to run continuously as a stream on the backend, running `.sort()` on thousands of items every time would be `O(n log n)`.
to optimize it, we should use a **min-heap (priority queue)** of size `N` (where N is the number of items we want to keep, like 10).
whenever a new notification arrives, we calculate its score. if the score is greater than the root of our min-heap, we pop the root and push the new one. this gives us `O(log k)` insertion time, which is much faster for a live stream.
