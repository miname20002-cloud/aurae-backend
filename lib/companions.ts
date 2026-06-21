export type Companion = {
  id: string;
  name: string;
  gender: "female" | "male";
  initial: string;
  accent: string;
};

export const COMPANIONS: Companion[] = [
  { id: "chloe", name: "Chloe", gender: "female", initial: "C", accent: "#8B7CF6" },
  { id: "maya", name: "Maya", gender: "female", initial: "M", accent: "#E08F6B" },
  { id: "ethan", name: "Ethan", gender: "male", initial: "E", accent: "#5FAE96" },
  { id: "jayden", name: "Jayden", gender: "male", initial: "J", accent: "#D4719B" },
];

export function companionsFor(gender: "female" | "male"): Companion[] {
  return COMPANIONS.filter((c) => c.gender === gender);
}

export function companionById(id: string): Companion | undefined {
  return COMPANIONS.find((c) => c.id === id);
}
