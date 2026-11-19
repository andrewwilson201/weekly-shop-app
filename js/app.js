// Weekly Shop: the app's entry point. The shell (routing, rendering, the tap
// handlers) is js/core.js; each screen is a module in js/views/ that adds
// itself to core's routes and actions when it's loaded.
import { start } from './core.js?v=14';
import './views/signin.js?v=14';
import './views/week.js?v=14';
import './views/shop.js?v=14';
import './views/order.js?v=14';
import './views/history.js?v=14';
import './views/cook.js?v=14';
import './views/list.js?v=14';
import './views/meals.js?v=14';
import './views/staples.js?v=14';
import './views/settings.js?v=14';

start();
