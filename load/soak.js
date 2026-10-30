// Long load test, nightly (schedule of .github/workflows/nightly.yml): 20 minutes at a steady rate, then a
// ramp to find where p99 breaks. The thresholds fail the run and the nightly report shows it in RAPPORT.md.
import { asks, gates, health } from './smoke.js';

export { asks, gates, health };

export const options = {
  scenarios: {
    health: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '25m', preAllocatedVUs: 10, exec: 'health' },
    asks: { executor: 'constant-arrival-rate', rate: 500, timeUnit: '1s', duration: '20m', preAllocatedVUs: 100, exec: 'asks' },
    gates: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '20m', preAllocatedVUs: 50, exec: 'gates' },
    ramp: {
      executor: 'ramping-arrival-rate', startTime: '20m', startRate: 500, timeUnit: '1s', preAllocatedVUs: 400, exec: 'asks',
      stages: [{ target: 2000, duration: '3m' }, { target: 2000, duration: '2m' }],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{name:ask,scenario:asks}': ['p(95)<50', 'p(99)<150'],
    'http_req_duration{name:gate}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{name:approve}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{name:ask,scenario:ramp}': ['p(99)<500'],
  },
};
