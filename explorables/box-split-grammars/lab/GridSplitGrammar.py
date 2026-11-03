"""
GridSplitGrammar.py: A headless 3D voxel grid backend for Box-Split Grammars.
Allows running Minecraft temple, castle, and floor plan grammar rules without
requiring MCEdit or Python 2.7.
"""
from SplitGrammar import rule, split, reorient, void, fill, Dimension, Direction, Constraint, Scope, clearrules, make_box, box, Rounding
import SplitGrammar

class VoxelGrid:
    def __init__(self, size):
        self.width, self.height, self.length = size
        # Stores (x, y, z) -> material_id
        self.voxels = {}

    def set_block(self, x, y, z, material):
        if 0 <= x < self.width and 0 <= y < self.height and 0 <= z < self.length:
            self.voxels[(x, y, z)] = material

    def get_block(self, x, y, z):
        return self.voxels.get((x, y, z), 0)

    def render_ascii_slice(self, y_level=0, char_map=None):
        """Render a horizontal 2D slice (x across, z down) as ASCII text."""
        if char_map is None:
            char_map = {0: " . ", 155: "[#]", 1: "[#]", -1: "[#]"}
        lines = []
        for z in range(self.length):
            row = []
            for x in range(self.width):
                mat = self.get_block(x, y_level, z)
                row.append(char_map.get(mat, f"[{mat % 10}]"))
            lines.append("".join(row))
        return "\n".join(lines)


class GridScope(Scope):
    def __init__(self, grid, box, **kwargs):
        super(GridScope, self).__init__(box, **kwargs)
        self.grid = grid

    def make_child(self, box, **kwargs):
        return GridScope(self.grid, box, **kwargs)

    def set_material(self, material):
        for (x, y, z) in self.box.positions:
            self.grid.set_block(x, y, z, material)


def start_symbol(box, grid):
    scope = GridScope(grid, box, source="Root")
    return SplitGrammar.start_symbol(scope)


COBBLESTONE = 4
MARBLE = 155
STONE = 1

SplitGrammar.register_material(-1, MARBLE)
SplitGrammar.register_material(0, 0) # air / void
SplitGrammar.register_material(155, MARBLE)
SplitGrammar.register_material(4, COBBLESTONE)
SplitGrammar.register_material(1, STONE)

