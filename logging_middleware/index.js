// store token here so we dont have to pass it everywhere
let token = '';

const setLogToken = (t) => {
  token = t;
};

const Log = async (stack, level, pkg, message) => {
  // try pulling from env if not set
  const finalToken = token || (process && process.env && process.env.LOG_ACCESS_TOKEN);
  
  if (!finalToken) {
    console.warn("heads up: no token set for logging");
    return;
  }

  // format as required by the api (lowercase everything)
  const body = {
    stack: String(stack).toLowerCase(),
    level: String(level).toLowerCase(),
    package: String(pkg).toLowerCase(),
    message: String(message)
  };

  try {
    const res = await fetch('http://20.207.122.201/evaluation-service/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${finalToken}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.log(`logging failed with status: ${res.status}`);
    }
  } catch (err) {
    console.log('could not reach log server', err);
  }
}

module.exports = { Log, setLogToken };
