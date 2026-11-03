from SplitGrammar import rule, split, reorient, void, fill, Dimension, Direction, Constraint, Scope, clearrules, make_box, box
import SplitGrammar

class PNGScope(Scope):
    def __init__(self, image, box, **kwargs):
        super(PNGScope, self).__init__(box, **kwargs)
        self.image = image
        if not hasattr(image, "zBuffer"):
            self.image.zBuffer = [[float('inf') for _ in range(image.height)] for _ in range(image.width)]

    def make_child(self, box, **kwargs):
        return PNGScope(self.image, box, **kwargs)
        
    def set_material(self, material):
        for (x, y, z) in self.box.positions:
            if 0 <= x < self.image.width and 0 <= y < self.image.height:
                if z < self.image.zBuffer[x][y]:
                    self.image.zBuffer[x][y] = z 
                    self.image.putpixel((x, y), material)
            
def start_symbol(box, image):
    scope = PNGScope(image, box, source="Root")
    return SplitGrammar.start_symbol(scope)
    
WHITE = (255, 255, 255)
RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
    
SplitGrammar.register_material(-1, WHITE)
SplitGrammar.register_material(0, RED)
SplitGrammar.register_material(1, GREEN)
SplitGrammar.register_material(2, BLUE)

