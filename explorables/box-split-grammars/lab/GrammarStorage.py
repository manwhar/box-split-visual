# GrammarStorage.py
# Global registry for rules, current execution context stack, and registered materials.

RULES = {}
CONTEXT = []
MATERIALS = {}

def reset():
    global RULES, CONTEXT, MATERIALS
    RULES.clear()
    CONTEXT.clear()
    MATERIALS.clear()

