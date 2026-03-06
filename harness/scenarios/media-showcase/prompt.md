# Media Showcase -- Earth's Extremes

You are producing a visual media showcase: a series of scenes that demonstrate mastery of image composition on a 1920x1080 broadcast canvas. The theme is "Earth's Extremes" -- the most dramatic landscapes on the planet. Image URLs are provided in the seed file. This is a photography exhibition brought to life with broadcast production value.

## First Step

Discover the full component catalog before producing anything. Study every component -- especially Image, Overlay, Gradient, Split, Grid, Box, Animate, Stagger, LowerThird, and Text. These are your tools for composing images with text, layering content over photos, and building gallery layouts. Know them before you start.

Read the seed file (`seed/images.json`) to get the curated image URLs. Use these exact URLs -- do not fabricate or search for others.

## Quality Standards

- **Photography exhibition quality.** Every scene should feel like a curated gallery wall or a broadcast title card. Images are the star -- text and overlays support them, never compete.
- **Full canvas usage.** The canvas is 1920x1080. Use ALL of it. Full-bleed images. Edge-to-edge grids. No floating thumbnails in a sea of empty space.
- **Typographic restraint.** When text overlays an image, it must be legible. Use Gradient overlays (dark, semi-transparent) behind text, or place text in high-contrast regions. Never put white text on a bright image without a scrim.
- **Variety of compositions.** Each scene uses a fundamentally different layout strategy. No two scenes should feel like the same template with different content.
- **Cinematic pacing.** Use Animate and Stagger to reveal content with intentional timing. Images that snap into existence feel cheap. Images that fade or slide in feel produced.

## The Scenes

Produce exactly six scenes as a timeline. Each scene demonstrates a different image layout technique.

### Scene 1: Hero Takeover

A single full-bleed image fills the entire 1920x1080 canvas. Use the hero image from the seed file. Layer a Gradient overlay (dark at the bottom, transparent at the top) and place a large Heading at the bottom-left with the title "EARTH'S EXTREMES" and a Text subtitle. Use Animate to fade the title in. This is a cinematic title card -- the image does all the work, the text just anchors it.

### Scene 2: Split Comparison

Use Split to create a side-by-side layout with two gallery images. Each side gets a full-height image. Between or below the images, add a thin accent bar (a colored Box or Divider) and a caption for each. The viewer's eye should compare the two landscapes. Use contrasting images -- coast vs. desert, or forest vs. arctic. Use Stagger to bring the two halves in sequentially.

### Scene 3: Photo Grid

Build a 2x3 or 3x2 grid of gallery images using Grid. Each cell is an Image that fills its grid cell completely (object-fit: cover). Below the grid or overlaid on it, add a Heading like "Field Survey" or "Expedition Log." Use Stagger so the grid cells appear one at a time with a staggered entrance animation. The grid should fill the canvas -- no margins or padding that waste space.

### Scene 4: Text Over Image

A full-bleed background image with substantial text content overlaid. Use one of the texture images as a full-canvas background Image. Layer an Overlay on top containing a semi-transparent Gradient scrim, then place a Card or structured text layout with a quote, attribution, and supporting details. This tests readability -- the text must be perfectly legible over the photo. Use a dark gradient scrim (e.g., rgba(0,0,0,0.6)) to ensure contrast.

### Scene 5: Portrait Gallery with Attribution

Use a horizontal layout (Split or Stack with horizontal direction) to show the three portrait images side by side. Below each portrait, use LowerThird to attribute the person's name and title. The portraits should be cropped to consistent sizes. Use Stagger to reveal the portraits left to right. This is a "meet the team" broadcast moment.

### Scene 6: Closing Montage

A final summary scene that layers multiple images at different scales. Use Box with absolute positioning (via style overrides) to place 3-4 images at different sizes and positions across the canvas, slightly overlapping like a scattered photo collage. Overlay a large closing title: "EVERY LANDSCAPE TELLS A STORY" with a Gradient backdrop. Use Animate with a slow fade-in for the final title. End with presence and weight.

## Technical Notes

- The Image component accepts `src` (URL string), `alt` (accessibility text), `fit` ("cover", "contain", "fill", "none"), and `style` overrides. Use `fit: "cover"` for all full-bleed and grid images so they fill their containers without distortion.
- To make an Image fill its parent, set `style: { width: "100%", height: "100%" }` on the Image and ensure the parent Box/Grid cell has explicit dimensions.
- For text-over-image compositions, the pattern is: Box (with position: relative) containing an Image, then an Overlay (position: absolute) with a Gradient scrim and text children.
- All picsum.photos URLs return real photographs. They may take a moment to load on first request; this is expected.
