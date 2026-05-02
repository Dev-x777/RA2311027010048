const API_TOKEN = process.env.ACCESS_TOKEN || '';
const API_URL = 'http://20.207.122.201/evaluation-service/notifications';

const weightMap = {
  'Placement': 3,
  'Result': 2,
  'Event': 1
};

const getScore = (notif) => {
  const w = weightMap[notif.Type] || 0;
  // get seconds from the timestamp
  const timeSecs = Math.floor(new Date(notif.Timestamp).getTime() / 1000);
  return (w * 1000000000) + timeSecs;
};

const fetchTopPriority = async (limit = 10) => {
  if (!API_TOKEN) {
    console.log('no token provided. make sure to set ACCESS_TOKEN in env.');
    return [];
  }

  try {
    const res = await fetch(API_URL, {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    });
    
    if (!res.ok) {
      console.log('failed to fetch notifications. status:', res.status);
      return [];
    }
    
    const body = await res.json();
    const list = body.notifications || [];

    // sort highest score first
    list.sort((a, b) => getScore(b) - getScore(a));

    return list.slice(0, limit);
  } catch (err) {
    console.error('error pulling notifications:', err);
    return [];
  }
};

const run = async () => {
  console.log('fetching top priority inbox...');
  const top10 = await fetchTopPriority(10);
  
  if (!top10 || top10.length === 0) {
    console.log('no notifications returned.');
    return;
  }

  top10.forEach((item, idx) => {
    console.log(`${idx + 1}. [${item.Type}] ${item.Message} | ${item.Timestamp}`);
  });
};

run();
