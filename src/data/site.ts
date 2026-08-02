export const SITE = {
  name: "Voice Gender Test",
  url: "https://voicegendertest.com",
  email: "hello@voicegendertest.com",
  description:
    "Use this free voice gender test to record a sample and explore pitch, variation, and spectral brightness in the browser. Private, with no audio uploads.",
} as const;

export const navItems = [
  { href: "/methodology/", label: "Methodology" },
  {
    href: "/resources/voice-pitch-vs-gender-presentation/",
    label: "Voice guide",
  },
  { href: "/privacy/", label: "Privacy" },
  { href: "/about/", label: "About" },
] as const;

export const faqs = [
  {
    question: "What does the voice gender test measure?",
    answer:
      "It measures acoustic features in one short recording: median pitch, pitch variation, and a spectral brightness proxy. It also checks whether the recording is clear enough to analyze. These features can shape vocal presentation, but they do not determine identity.",
  },
  {
    question: "Does this test determine my gender?",
    answer:
      "No. Gender identity cannot be determined from a voice recording. The result describes sound patterns in this recording only and uses neutral, descriptive language instead of assigning a gender.",
  },
  {
    question: "How accurate is the result?",
    answer:
      "The pitch and signal measurements are engineering estimates, not a clinical or demographic assessment. Accuracy varies with your microphone, room, speaking style, and recording quality. The site does not publish an unvalidated accuracy percentage.",
  },
  {
    question: "Is my voice recording uploaded or stored?",
    answer:
      "No. Audio is analyzed in your browser and is not uploaded, saved to a database, or placed in browser storage. Closing or refreshing the page clears the current result.",
  },
  {
    question: "Why can my result change between recordings?",
    answer:
      "Pitch and vocal delivery naturally change with the words you say, emotion, effort, distance from the microphone, and background noise. For comparisons, use the same phrase, device, room, and speaking volume.",
  },
  {
    question: "Are there fixed male and female pitch ranges?",
    answer:
      "No fixed boundary works for everyone. Published ranges overlap, and listeners also respond to resonance, intonation, articulation, context, and many other cues. That is why this tool reports measurements rather than a binary verdict.",
  },
  {
    question: "Can accent or microphone quality affect the result?",
    answer:
      "Yes. Accent and speaking pattern can change pitch variation, while microphones and rooms can change spectral measurements. Repeat tests on the same setup when tracking change over time.",
  },
  {
    question: "Can I use this for voice training?",
    answer:
      "You can use repeated measurements as a simple practice reference, but the tool is not a substitute for individualized guidance from a qualified speech-language professional. Stop if practice causes pain, strain, or persistent hoarseness.",
  },
] as const;
