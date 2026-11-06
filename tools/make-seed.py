# Makes a seed file for Settings › Import from the old weekly-shop files:
#   python3 tools/make-seed.py staples-plan.json meal-history.json [shops/*/list.json ...] > seed.json
# Any list.json files given update last_bought for staples bought since the plan was built.
# Staples keep their due-rule fields; meal history becomes "times chosen" counts,
# matched to data/recipes.json by name. The seed has purchase history in it, so
# don't commit it (it's in .gitignore).
import json, sys, os

plan = json.load(open(sys.argv[1]))
history = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {'weeks': []}
recipes = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'data', 'recipes.json')))['meals']

def match(short):
    s = short.lower()
    for r in recipes:
        if r['name'].lower().startswith(s) or s.startswith(r['name'].lower()):
            return r['name']
    return short

meals = {}
for w in history.get('weeks', []):
    day = w.get('delivery_day') or w['week']
    for name in w.get('chosen') or []:
        full = match(name)
        m = meals.setdefault(full, {'name': full, 'timesChosen': 0, 'lastChosen': None})
        m['timesChosen'] += 1
        m['lastChosen'] = max(m['lastChosen'] or '', day)

keys = ['product_uid', 'name', 'rule', 'quantity', 'every_days', 'last_bought', 'family', 'times_bought', 'share_pct']
staples = [{k: s.get(k) for k in keys} for s in plan['items']]
by_uid = {s['product_uid']: s for s in staples}
for path in sys.argv[3:]:
    lst = json.load(open(path))
    day = lst.get('delivery')
    for it in lst.get('items', []):
        s = by_uid.get(str(it.get('id')))
        if s and day and it.get('status') in ('OK', 'planned', 'added') and day > (s['last_bought'] or ''):
            s['last_bought'] = day
json.dump({'staples': staples, 'meals': list(meals.values())}, sys.stdout, indent=1)
