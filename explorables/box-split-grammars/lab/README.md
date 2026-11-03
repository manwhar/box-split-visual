# Box-Split Grammars: Runnable System Recreation

This folder contains a self-contained, modernized recreation of the system described in:

> **Instant Architecture in Minecraft using Box-Split Grammars**  
> Markus Eger (Cal Poly Pomona)  
> *FDG '22: Proceedings of the 17th International Conference on the Foundations of Digital Games*, September 5–8, 2022, Athens, Greece.  
> ACM ISBN 978-1-4503-9795-7/22/09. DOI: 10.1145/3555858.3555865

The original reference code was released under the CRAPL license at `https://github.com/yawgmoth/BoxSplitGrammars`.

---

## What is Recreated and Verified

The paper introduces **Box-Split Grammars** for procedural modeling in voxel/grid environments. All central mechanisms from the paper have been recreated and verified:

1. **Boxes & Coordinates (Section 3.1 & 3.3):**
   - Axis-aligned 3D integer bounding boxes (`GrammarBox.py`).
   - Local coordinate systems and permutation-based reorientation via `reorient()` (`Dimension.X`, `Dimension.Y`, `Dimension.Z`, `Dimension.WORLD_*`, `Dimension.LARGEST`, `Dimension.SMALLEST`).

2. **Split Rules (Section 3.2):**
   - Partitioning a box along a chosen dimension into slices specified by a sequence of positive (absolute) and negative (relative) integer lengths.
   - Sizing and rounding rules: allocating absolute sizes first, dividing remainder proportionally across relative sizes, with support for `Rounding.TRUNCATE`, `Rounding.START`, and `Rounding.END`.
   - Verified against the paper's four split cases and remainder distributions on 10 and 12 block scopes (Figure 2).

3. **Repetition / Iteration (Section 3.4):**
   - `split(..., repeat=True)` producing an iterable sequence of scopes.
   - Verified against Figure 3 alternating fill/void patterns.

4. **Probabilistic Rules & Arithmetic Constraints (Section 3.5 & 3.6):**
   - `@rule(probability=p, constraint=c)` decorator dispatch with normalized weights.
   - Dynamic evaluation of arithmetic constraints on box dimensions (e.g. `Dimension.X % 2 == 0`) and fallback via `Constraint.ELSE`.

5. **Greek Temple Floor Plans (Section 4, Figure 4 & Figure 7):**
   - Modeling architectural floor plans using modular grammar rules (`floorplan`, `naos`, `chamber`, `columns`).
   - Recreated and verified against Figure 4 (amphi-prostyle tetrastyle temple floor plan).

6. **2D Image / Pixel Backend (Section 4, Figure 9):**
   - Drawing recursive spiral patterns with `PNGSplitGrammar.py` using z-buffering.
   - Verified by generating the blue-and-white spiral pattern from Figure 9.

---

## Modernization & Dependencies

The original code targeted Python 2.7 with MCEdit dependencies (`pymclevel`). In this lab:
- Upgraded to Python 3.10+ standard library.
- Provided `GridSplitGrammar.py`: a headless 3D voxel grid backend that eliminates the need for MCEdit or an active Minecraft installation, while accurately simulating block placement and 2D ASCII horizontal slices.
- `PNGSplitGrammar.py` uses `Pillow` for PNG generation.

## How to Run Checks

Run the verification suite:
```bash
python lab/verify_paper.py
```

Expected output:
```
--- Running Box-Split Grammar System Verification ---
[PASS] Test 1: Figure 2 split sizing & rounding rules verified
[PASS] Test 2: Coordinate reorientation verified
[PASS] Test 3: Repeating split iteration (Figure 3) verified
[PASS] Test 4: Rule constraints & Constraint.ELSE verified
[PASS] Test 5: Figure 4 Temple floor plan verified
[PASS] Test 6: Figure 9 2D recursive spiral pattern verified

ALL 6 CHECKS PASSED: The paper's mechanisms are fully recreated and verified!
```

