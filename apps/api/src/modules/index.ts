import type { ModuleDefinition } from '../kernel/module.js';
import m01 from './m01-identity/index.js';
import m02 from './m02-organisation/index.js';
import m03 from './m03-patients/index.js';
import m04 from './m04-referrals/index.js';
import m05 from './m05-scheduling/index.js';
import m06 from './m06-funding/index.js';
import m07 from './m07-registration/index.js';
import m08 from './m08-acquisition/index.js';
import m09 from './m09-imaging/index.js';
import m10 from './m10-dose/index.js';
import m11 from './m11-bci/index.js';
import m12 from './m12-reporting/index.js';
import m13 from './m13-results/index.js';
import m14 from './m14-billing/index.js';
import m15 from './m15-finance/index.js';
import m16 from './m16-analytics/index.js';
import m17 from './m17-workforce/index.js';
import m18 from './m18-assets/index.js';
import m19 from './m19-compliance/index.js';
import m20 from './m20-hands/index.js';

/** Registration order matters only for boot(); routes are independent. */
export const modules: ModuleDefinition[] = [m01, m02, m03, m04, m05, m06, m07, m08, m09, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20];
