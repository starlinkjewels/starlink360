import { PanelGroup, PanelIntro } from "../ui/Panel";
import { SECTIONS } from "../shell/sections";

/*
 * What every section does, in the words of the person using it.
 *
 * The rail already carries a one-line hint per section. This is the other
 * half: what the section is for, how it is actually driven, and the one thing
 * that catches people out — because every one of these was learned from
 * somebody getting it wrong, not guessed at.
 *
 * Keyed by section id so the list cannot drift from the rail. A section with
 * no entry is reported at the bottom rather than passed over in silence: a
 * help page that quietly omits a feature is worse than one that admits the
 * gap, since the reader cannot tell the difference between "not documented"
 * and "not there".
 */
interface Topic {
  /** Matches a section id in the rail. */
  id: string;
  /** What it is for. */
  what: string;
  /** How it is driven, in order. */
  how: string;
  /** The thing people get wrong. Omitted where there genuinely is none. */
  watch?: string;
  /**
   * The order to do it in.
   *
   * Written for somebody who has not used a 3D tool before, because most of
   * the people opening this have not. Where order does not matter there are no
   * steps, rather than a list invented to fill the space.
   */
  steps?: string[];
}

const TOPICS: Topic[] = [
  {
    id: "assistant",
    what: "Drives the studio in plain language, so a change can be asked for rather than found.",
    how: 'Type what you want — "make the metal rose gold", "turn the lighting", "spin it slowly". It moves the same controls the panels do, so anything it changes can be corrected by hand afterwards.',
    watch:
      "It changes the scene, it does not know your piece. Asking it to select the prongs will not work; the Objects section does that.",
  },
  {
    id: "objects",
    what: "Every object in the file, by name — metal, stones, and the prongs found among the metal.",
    steps: [
      "Open Objects. Metal, Stones and Prongs each list what the file contains.",
      "Click a NAME to select just that one. The piece highlights it so you can confirm you have the right object.",
      "Click a BOX to add to the selection instead of replacing it. Boxes across different sections combine, so metal plus stones in one go is normal.",
      "Use ALL on a heading to take a whole kind at once.",
      "Type a name and save the selection. It comes back with one click on any later day.",
    ],
    how: "A NAME selects that object alone. Its BOX adds it to what is already selected, so you can build up metal 1, 5 and 8 plus stones 3 and 6 across sections. ALL takes a whole kind at once. Save any selection as a named set to bring it back later.",
    watch:
      "Prongs are found by geometry, not read from the file — metal that sits near a stone and is smaller than it. Check the selection before relying on it, and click on the piece to add anything it missed.",
  },
  {
    id: "metal",
    what: "The metal itself: gold in its colours, silver, platinum, and the finish on top.",
    steps: [
      "Decide the scope first. Nothing selected means the whole piece; a selection means only that.",
      "Pick the metal. Yellow, rose and white gold differ in colour; platinum and silver differ in how bright the reflection is.",
      "For two-tone, set the whole piece first, then select the parts that differ and set those second.",
    ],
    how: "Select nothing to change the whole piece. Select parts first to change only those, which is how two-tone is built.",
    watch:
      "Metal is almost entirely reflection. If gold looks flat, the fix is usually in Environment rather than here.",
  },
  {
    id: "stones",
    what: "What each stone is made of — diamond, moissanite, sapphire, and the rest.",
    steps: [
      "Select one stone, several, or all of them from Objects.",
      "Choose the gem. Each has its own refractive index and dispersion, so moissanite throws more fire than diamond rather than being a recolour.",
      "For a coloured centre in a white pave, select the centre alone and set it last.",
    ],
    how: "Pick one stone or all of them, then choose the gem. Each carries its own published optics, so the fire differs between them rather than being one shader tinted a different colour.",
    watch:
      "Colour lands on the stone you clicked. If it appears to spread to a neighbour, that is worth reporting — it is a bug, not a setting.",
  },
  {
    id: "textures",
    what: "Surface finish per part: polished, brushed, matte, hammered.",
    how: "Select the parts, then the finish. Finish changes how sharp a reflection is, which reads as strongly as colour does.",
  },
  {
    id: "stamp",
    what: "Hallmarks struck into the metal — karat marks, a maker's mark, custom text.",
    steps: [
      "Choose or type the mark.",
      "Click the spot on the piece where it should sit. Pick somewhere flat — an inner shank, the back of a pendant.",
      "Set the size against the part, then the depth. Shallow reads as worn, deep reads as freshly struck.",
      "Turn the piece and check it under the light. A stamp is only convincing when its edges catch.",
    ],
    how: "Choose the mark, click where it goes on the piece, then adjust size and depth. It is cut into the surface, not painted on, so it catches light along its edges as a real stamp does.",
    watch:
      "Place it on a flat enough area. Struck across a sharp edge it will read as broken, exactly as it would in metal.",
  },
  {
    id: "prongs",
    what: "Raises or lowers a single claw, for the lifted prong that a photograph exposes.",
    how: "Select the claw — the Prongs section in Objects lists them all — then adjust its height.",
  },
  {
    id: "bg",
    what: "The environment the piece sits in, and what it reflects. The most important section for how metal looks.",
    steps: [
      "Choose an environment. This is what the metal reflects and what the stones see.",
      "Turn it. Rotating the environment slides the highlights around the piece, which is how a chain is made to catch light along its length.",
      "Set the backdrop separately. What sits behind the piece and what it reflects are two different choices.",
    ],
    how: "Choose an environment, then turn it to move the highlights around the piece. The backdrop behind the piece is set separately from what it reflects.",
    watch:
      "Metal shows you the environment and nothing else. Flat, even gold means an environment with no shape in it; one with real softbox forms is what puts bright streaks along a chain.",
  },
  {
    id: "light",
    what: "The light rig on the metal, and overall exposure.",
    how: "Add or remove lights and place them. Exposure lifts or drops the whole frame.",
    watch:
      "This lights the METAL. What the stones see is the environment, read by their own shader — so a dull stone is fixed in Environment, not here.",
  },
  {
    id: "shadow",
    what: "What the piece casts, which is what tells the eye where it is.",
    how: "A contact pool for a soft studio look, or a real shadow camera for a directional one.",
    watch: "A piece with no shadow floats, and floating is one of the clearest signs of a render.",
  },
  {
    id: "ground",
    what: "The surface underneath.",
    how: "Choose the surface and how reflective it is.",
  },
  {
    id: "bloom",
    what: "The halo around anything bright enough to blow out a camera — which on jewellery means the stones.",
    steps: [
      "Leave it on. It is on by default because it is most of what makes a stone read as a stone.",
      "If the piece looks foggy, raise the threshold — the metal is glowing when only the stones should.",
      "If the sparkle looks weak, raise the strength before lowering the threshold.",
    ],
    how: "On by default, because it is most of what makes a diamond read as a diamond. Threshold sets how bright a pixel must be before it glows.",
    watch:
      "Drop the threshold too far and the metal glows too, which reads as fog rather than sparkle. Near 1.0 keeps it to genuine sparkle.",
  },
  {
    id: "spin",
    what: "Movement — a turntable, or a piece that moves on its own.",
    how: "Pick a move, set its speed, and play it. What plays is what records in Video.",
  },
  {
    id: "camera",
    what: "The lens. Projection, focal length and clipping.",
    how: "A longer lens flattens perspective, which is what product photography uses. Orthographic removes perspective entirely, for a technical view.",
  },
  {
    id: "dimensions",
    what: "The real size of the piece in millimetres, how many stones it holds, and roughly what they weigh.",
    steps: [
      "Look at Real width first. It is read from the file where the file says, and a .3dm from CAD usually does.",
      "If it is blank or wrong, type the true width in millimetres. Everything else — height, depth, stone sizes — is scaled from that one number.",
      "Read off the gem count and estimated carat weight for the quote.",
    ],
    how: "One measured dimension sets the scale for all of them. Until the piece has a known width it reports bare multiples with a x rather than millimetres, because a number in the wrong unit is worse than no number.",
    watch:
      "The carat weight is estimated from the modelled stone volume, not from a certificate. It is right for quoting and for spotting a stone that was modelled at the wrong size — it is not a grading report.",
  },
  {
    id: "photos",
    what: "Stills, at print resolution.",
    steps: [
      "Frame the piece on screen first. What you see is what is saved.",
      "Choose the destination. Each preset already carries the size and shape that platform wants.",
      "Download. It renders larger than the screen and scales down, which is what makes the edges clean.",
    ],
    how: "Choose a destination — the presets already carry the size and framing each one wants — then download. What you see is what is saved, rendered at higher resolution than the screen.",
    watch:
      "Larger is slower, and past a point no sharper. The preset sizes are chosen to sit under that point.",
  },
  {
    id: "video",
    what: "A clip of whatever is currently animating.",
    steps: [
      "Go to Animation, choose a move, and play it. Watch it through once.",
      "Frame the piece while it plays. That framing is what records.",
      "Come to Video, set the length and size, and download. Give it time — a long clip at high resolution encodes slowly on purpose.",
    ],
    how: "Set the animation up first and watch it play, then come here — the framing you can see is the framing that records.",
    watch:
      "Longer clips at high resolution take real time to encode. The bitrate is set high on purpose: compression is what makes a clip look cheap.",
  },
  {
    id: "mark",
    what: "Your studio's branding on downloads.",
    how: "Set the text or logo, its position and how strong it is. It is applied to exports, not to the working view.",
  },
];

const BY_ID = new Map(TOPICS.map((t) => [t.id, t]));

export function HelpPanel() {
  /* Rail order, so reading down the help matches reading down the studio. */
  const documented = SECTIONS.filter((s) => s.id !== "help" && BY_ID.has(s.id));
  const missing = SECTIONS.filter((s) => s.id !== "help" && !BY_ID.has(s.id));

  return (
    <>
      <PanelIntro>
        Every section, in the order they appear. If you are starting out: load a piece, choose an
        environment, then set the metal — those three decide most of how it looks.
      </PanelIntro>

      <PanelGroup title="Getting around">
        <div className="help-topic">
          <p className="field-hint">
            <b>Drag</b> to turn the piece, <b>scroll</b> to zoom, <b>right-drag</b> to slide it
            across the frame. Clicking an object selects it; clicking the background clears the
            selection.
          </p>
          <p className="field-hint">
            Anything you select is what the next change applies to. With nothing selected, a change
            applies to the whole piece.
          </p>
        </div>
      </PanelGroup>

      {documented.map((section) => {
        const topic = BY_ID.get(section.id);
        if (!topic) return null;
        return (
          <PanelGroup key={section.id} title={section.title}>
            <div className="help-topic">
              <p className="field-hint">{topic.what}</p>
              <p className="field-hint">{topic.how}</p>
              {topic.steps && (
                <ol className="help-steps">
                  {topic.steps.map((step) => (
                    <li key={step} className="field-hint">
                      {step}
                    </li>
                  ))}
                </ol>
              )}
              {topic.watch && (
                <p className="field-hint help-watch">
                  <b>Worth knowing.</b> {topic.watch}
                </p>
              )}
            </div>
          </PanelGroup>
        );
      })}

      <PanelGroup title="When it does not look right">
        <div className="help-topic">
          <p className="field-hint">
            <b>The gold looks flat and even.</b> Metal shows you the environment and nothing else.
            Change the environment, or turn it, before touching the metal colour.
          </p>
          <p className="field-hint">
            <b>The stones look like grey dots.</b> Check Post Processing is on. The halo around a
            flash is most of what makes a stone look real.
          </p>
          <p className="field-hint">
            <b>The piece looks like it is floating.</b> Give it a shadow. Nothing tells the eye
            where an object is more directly than what it casts.
          </p>
          <p className="field-hint">
            <b>A download looks softer than the screen.</b> Raise the size in Photos. Small exports
            are scaled from fewer pixels than the preview uses.
          </p>
          <p className="field-hint">
            <b>The file will not load.</b> Very large models are refused rather than crashed on.
            Decimate it in your CAD tool and try again.
          </p>
        </div>
      </PanelGroup>

      {missing.length > 0 && (
        <PanelGroup title="Not yet written up">
          <p className="field-hint">
            {missing.map((s) => s.title).join(", ")} — in the studio, not in this help yet. Said
            plainly rather than left out, so you know the gap is in the writing and not the feature.
          </p>
        </PanelGroup>
      )}
    </>
  );
}
