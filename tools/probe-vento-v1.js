'use strict';

const { VentoV1Client } = require('../lib/vento-v1-client');

async function main() {
  const [ip, command, value, ...extra] = process.argv.slice(2);
  if (!ip || extra.length || (command && (!['speed', 'mode', 'timer'].includes(command) || !/^[0-3]$/.test(value)))) {
    throw new Error('Usage: node tools/probe-vento-v1.js <IPv4 address> [speed <1|2|3> | mode <0|1|2> | timer <0|1|2>]');
  }
  const client = new VentoV1Client(ip);
  let result;
  if (command === 'speed') result = await client.setSpeed(Number(value));
  else if (command === 'mode') result = await client.setOperationMode(Number(value));
  else if (command === 'timer') result = await client.setTimerMode(Number(value));
  else result = await client.readStatus();
  const { status, raw } = result;
  process.stdout.write(`${JSON.stringify({ status, raw: raw.toString('hex') }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
