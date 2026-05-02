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
