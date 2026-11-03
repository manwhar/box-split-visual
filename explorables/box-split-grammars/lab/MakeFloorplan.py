"""
MakeFloorplan.py: Reproduces Figure 4 and Figure 7 temple floor plans
from 'Instant Architecture in Minecraft using Box-Split Grammars' (FDG 2022).
"""
from GridSplitGrammar import rule, split, reorient, void, fill, start_symbol, Dimension, Direction, Constraint, clearrules, make_box, VoxelGrid, MARBLE
import GrammarStorage

clearrules(__file__)

# --- Figure 4 rules (as printed in Section 4 / Figure 4a of the paper) ---
# Width along X (7 blocks for tetrastyle: 4 columns + 3 gaps), Depth along Z.

@rule 
def fig4_columns():
    with split(Dimension.X, [1, 1, 1, 1, 1, 1, 1]):
        fill(MARBLE)
        void()
        fill(MARBLE)
        void()
        fill(MARBLE)
        void()
        fill(MARBLE)

@rule   
def fig4_chamber():
    with split(Dimension.X, [1, -1, 1]):
        fill(MARBLE)
        void()
        fill(MARBLE)

@rule
def fig4_naos():
    with split(Dimension.Z, [1, -1, 1]):
        fig4_columns()
        fig4_chamber()
        fill(MARBLE)

@rule
def fig4_floorplan():
    with split(Dimension.Z, [1, 1, -1, 1, 1]):
        fig4_columns()
        void()
        fig4_naos()
        void()
        fig4_columns()

def generate_fig4_floorplan(width=7, depth=11):
    grid = VoxelGrid((width, 1, depth))
    bbox = make_box((0, 0, 0), (width, 1, depth))
    start_symbol(bbox, grid)
    fig4_floorplan()
    return grid

# --- Original MakeFloorplan rules (rotated: X is depth, Z is width) ---
@rule 
def orig_columns():
    with split(Dimension.Z, [1, 1, 1, 1, 1, 1, 1]):
        fill(MARBLE)
        void()
        fill(MARBLE)
        void()
        fill(MARBLE)
        void()
        fill(MARBLE)

@rule   
def orig_chamber():
    with split(Dimension.Z, [1, -1, 1]):
        fill(MARBLE)
        void()
        fill(MARBLE)

@rule
def orig_naos():
    with split(Dimension.X, [1, -1, 1]):
        orig_columns()
        orig_chamber()
        fill(MARBLE)

@rule
def orig_floorplan():
    with split(Dimension.X, [1, 1, -1, 1, 1]):
        orig_columns()
        void()
        orig_naos()
        void()
        orig_columns()

def generate_orig_floorplan(depth=11, width=7):
    grid = VoxelGrid((depth, 1, width))
    bbox = make_box((0, 0, 0), (depth, 1, width))
    start_symbol(bbox, grid)
    orig_floorplan()
    return grid

if __name__ == "__main__":
    grid = generate_fig4_floorplan(width=7, depth=11)
    print("Generated Amphi-prostyle Tetrastyle Floorplan (Fig 4):")
    print(grid.render_ascii_slice(0))

