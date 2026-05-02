const express = require('express');
const { Log, setLogToken } = require('logging_middleware');

const app = express();
const port = process.env.PORT || 3000;

// grab token from env
const API_TOKEN = process.env.ACCESS_TOKEN || '';
setLogToken(API_TOKEN);

const BASE_URL = 'http://20.207.122.201/evaluation-service';

// standard 0/1 knapsack implementation
const computeSchedule = (limit, items) => {
  const len = items.length;
  // setup dp table
  const dp = [];
  for (let i = 0; i <= len; i++) {
    dp.push(new Array(limit + 1).fill(0));
  }

  for (let i = 1; i <= len; i++) {
    const current = items[i - 1];
    for (let w = 0; w <= limit; w++) {
      dp[i][w] = dp[i - 1][w];
      if (current.Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - current.Duration] + current.Impact);
      }
    }
  }

  // figure out which ones we picked
  const picked = [];
  let w = limit;
  let totalDur = 0;

  for (let i = len; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      const current = items[i - 1];
      picked.push(current);
      w -= current.Duration;
      totalDur += current.Duration;
    }
  }

  return {
    maxImpact: dp[len][limit],
    totalDur,
    picked
  };
};

const getDepots = async () => {
  const r = await fetch(`${BASE_URL}/depots`, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` }
  });
  const data = await r.json();
  return data.depots || [];
};

const getVehicles = async () => {
  const r = await fetch(`${BASE_URL}/vehicles`, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` }
  });
  const data = await r.json();
  return data.vehicles || [];
};

app.get('/depots', async (req, res) => {
  try {
    const data = await getDepots();
    res.json({ depots: data });
  } catch (e) {
    res.status(500).json({ error: "failed to fetch depots" });
  }
});

app.get('/vehicles', async (req, res) => {
  try {
    const data = await getVehicles();
    res.json({ vehicles: data });
  } catch (e) {
    res.status(500).json({ error: "failed to fetch vehicles" });
  }
});

app.get('/schedule', async (req, res) => {
  try {
    await Log("backend", "info", "handler", "computing schedules now");

    // fetch all data
    let depots = [];
    let vehicles = [];
    
    try {
      [depots, vehicles] = await Promise.all([getDepots(), getVehicles()]);
    } catch (e) {
      await Log("backend", "error", "service", "failed to pull API data");
      throw e;
    }

    await Log("backend", "info", "service", `got ${depots.length} depots and ${vehicles.length} vehicles`);

    const finalOutput = [];

    for (let d of depots) {
      const budget = d.MechanicHours;
      const result = computeSchedule(budget, vehicles);

      finalOutput.push({
        depotID: d.ID,
        mechanicHoursBudget: budget,
        totalImpact: result.maxImpact,
        totalDuration: result.totalDur,
        selectedTasks: result.picked.map(x => ({
          TaskID: x.TaskID,
          Duration: x.Duration,
          Impact: x.Impact
        }))
      });

      await Log("backend", "info", "service", `done with depot ${d.ID} - impact: ${result.maxImpact}`);
    }

    res.json(finalOutput);
  } catch (err) {
    console.error(err);
    await Log("backend", "error", "handler", "something broke while scheduling");
    res.status(500).json({ error: "internal error" });
  }
});

app.listen(port, () => {
  console.log(`running on ${port}`);
});
