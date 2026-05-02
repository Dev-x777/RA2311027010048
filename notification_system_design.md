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
