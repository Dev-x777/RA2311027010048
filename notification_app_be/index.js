const express = require('express');
const app = express();
const port = process.env.PORT || 4000;

const API_TOKEN = process.env.ACCESS_TOKEN || '';
const API_URL = 'http://20.207.122.201/evaluation-service/notifications';

const weightMap = {
  'Placement': 3,
  'Result': 2,
  'Event': 1
};

const getScore = (notif) => {
  const w = weightMap[notif.Type] || 0;
  const timeSecs = Math.floor(new Date(notif.Timestamp).getTime() / 1000);
  return (w * 1000000000) + timeSecs;
};

const fetchTopPriority = async (limit = 10) => {
  if (!API_TOKEN) {
    throw new Error('no token provided');
  }

  const res = await fetch(API_URL, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` }
  });
  
  if (!res.ok) {
    throw new Error('failed to fetch notifications');
  }
  
  const body = await res.json();
  const list = body.notifications || [];

  list.sort((a, b) => getScore(b) - getScore(a));

  return list.slice(0, limit);
};

app.get('/priority-inbox', async (req, res) => {
  try {
    const top10 = await fetchTopPriority(10);
    res.json({ success: true, priority_inbox: top10 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load priority inbox" });
  }
});

app.listen(port, () => {
  console.log(`notification app running on port ${port}`);
});

