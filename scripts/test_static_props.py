"""Self-check for static_props.entity_props' solidity rules: python scripts/test_static_props.py (needs numpy)."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from static_props import entity_props, FLAG_NO_DRAW, SOLID_NONE, SOLID_VPHYSICS  # noqa: E402

props, skipped = entity_props([
    {'classname': 'prop_dynamic', 'model': 'models\\Props\\Crate.mdl', 'origin': '1 2 3', 'angles': '0 90 0'},
    {'classname': 'prop_dynamic', 'model': 'models/a.mdl', 'spawnflags': '256'},
    {'classname': 'prop_dynamic_override', 'model': 'models/b.mdl', 'solid': '0', 'rendermode': '10'},
    {'classname': 'prop_physics_multiplayer', 'model': 'models/c.mdl'},
    {'classname': 'prop_physics_multiplayer', 'model': 'models/d.mdl', 'physicsmode': '1', 'modelscale': '2'},
    {'classname': 'prop_door_rotating', 'model': 'models/door.mdl'},
    {'classname': 'prop_dynamic', 'model': 'models/e.mdl', 'StartDisabled': '1'},
    {'classname': 'func_brush', 'model': '*3'},
], lambda origin: 7)
got = {p['model']: (p['solid'], p['flags'], p['scale']) for p in props}
assert got == {'models/props/crate.mdl': (SOLID_VPHYSICS, 0, 1.0), 'models/a.mdl': (SOLID_NONE, 0, 1.0), 'models/b.mdl': (SOLID_NONE, FLAG_NO_DRAW, 1.0),
               'models/c.mdl': (SOLID_NONE, 0, 1.0), 'models/d.mdl': (SOLID_VPHYSICS, 0, 2.0)}, got
assert props[0]['origin'] == (1, 2, 3) and props[0]['angles'] == (0, 90, 0) and props[0]['leaves'] == (7,)
assert dict(skipped) == {'non-solid physics': 1, 'prop_door_rotating': 1, 'disabled': 1}, skipped
print('entity_props ok')
