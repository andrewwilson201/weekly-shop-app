// Weekly Shop: the app's entry point. The shell (routing, rendering, the tap
// handlers) is js/core.js; each screen is a module in js/views/ that adds
// itself to core's routes and actions when it's loaded.
import { start } from './core.js?v=15';
import './views/signin.js?v=15';
import './views/week.js?v=15';
import './views/shop.js?v=15';
import './views/order.js?v=15';
import './views/history.js?v=15';
import './views/cook.js?v=15';
import './views/list.js?v=15';
import './views/meals.js?v=15';
import './views/staples.js?v=15';
import './views/settings.js?v=15';

start();
