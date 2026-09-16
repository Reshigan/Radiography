import { defineModule, router } from '../../kernel/index.js';

// M04 Referral & Orders — implemented by the module builder. Keep basePath 'referrals'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M04', status: 'stub' }));

export default defineModule({ code: 'M04', name: 'Referral & Orders', basePath: 'referrals', routes: r });
