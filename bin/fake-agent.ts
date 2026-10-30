// SPDX-License-Identifier: Apache-2.0
// Process entry of the fake agent (bin/fake-claude, bin/fake-codex). Kept to these lines on purpose: everything it
// does is in src/fake-agent.ts, covered by test/fake-agent.test.ts; this file is exercised by the e2e scenarios.
import { main } from '../src/fake-agent.ts';

process.exitCode = main(process.argv.slice(2), process.env, process.cwd());
