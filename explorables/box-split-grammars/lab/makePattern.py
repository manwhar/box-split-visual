from PIL import Image 
from PNGSplitGrammar import rule, split, reorient, void, fill, start_symbol, Dimension, Direction, Constraint, clearrules, make_box, RED, GREEN, BLUE, WHITE, box
import GrammarStorage

clearrules(__file__)

SPIRALWIDTH = 5

@rule
def bfill():
    with split(Dimension.X, [-1, SPIRALWIDTH]):
        fill(BLUE)
        fill(WHITE)

@rule(constraint=Dimension.Y > 2 * SPIRALWIDTH)
def bspiral():
    with split(Dimension.Y, [-1, SPIRALWIDTH, SPIRALWIDTH]):
        rspiral()
        bfill()
        fill(WHITE)

@rule(constraint=Constraint.ELSE)
def bspiral():
    fill(WHITE)
   
@rule
def lfill():
    with split(Dimension.Y, [-1, SPIRALWIDTH]):
        fill(BLUE)
        fill(WHITE)

@rule(constraint=Dimension.X > 2 * SPIRALWIDTH)
def lspiral():
    with split(Dimension.X, [SPIRALWIDTH, SPIRALWIDTH, -1]):
        fill(WHITE)
        lfill()
        bspiral()

@rule(constraint=Constraint.ELSE)
def lspiral():
    fill(WHITE)
   
@rule
def tfill():
    with split(Dimension.X, [SPIRALWIDTH, -1]):
        fill(WHITE)
        fill(BLUE)

@rule(constraint=Dimension.Y > 2 * SPIRALWIDTH)
def tspiral():
    with split(Dimension.Y, [SPIRALWIDTH, SPIRALWIDTH, -1]):
        fill(WHITE)
        tfill()
        lspiral()

@rule(constraint=Constraint.ELSE)
def tspiral():
    fill(WHITE)

@rule
def rfill():
    with split(Dimension.Y, [SPIRALWIDTH, -1]):
        fill(WHITE)
        fill(BLUE)

@rule(constraint=Dimension.X > 2 * SPIRALWIDTH)
def rspiral():
    with split(Dimension.X, [-1, SPIRALWIDTH, SPIRALWIDTH]):
        tspiral()
        rfill()
        fill(WHITE)

@rule(constraint=Constraint.ELSE)
def rspiral():
    fill(WHITE)

def tile():
    rspiral()
   
TILESIZE = 40

@rule()
def column():
    with split(Dimension.Y, [-1, -1]):
        pattern()
        pattern()

@rule(constraint=Dimension.X > TILESIZE)
def pattern():
    with split(Dimension.X, [-1, -1]):
        column()
        column()
        
@rule()
def pattern():
    tile()

def generate_spiral(output_path="spiral_result.png", size=(240, 240)):
    image = Image.new("RGB", size, (255, 255, 255))
    bbox = make_box((0, 0, 0), (size[0], size[1], 1))
    sc = start_symbol(bbox, image)
    pattern()
    image.save(output_path)
    return output_path

if __name__ == "__main__":
    out = generate_spiral("spiral_result.png", (480, 480))
    print(f"Generated {out}")

