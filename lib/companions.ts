export type Companion = {
  id: string;
  name: string;
  gender: "female" | "male";
  initial: string;
  accent: string;
  facePath: string;
};

export const COMPANIONS: Companion[] = [
  { id: "chloe", name: "Chloe", gender: "female", initial: "C", accent: "#8B7CF6", facePath: "assets/Chloe_Assets/Chloe_face.png" },
  { id: "maya", name: "Maya", gender: "female", initial: "M", accent: "#E08F6B", facePath: "assets/Maya_Assets/Maya_face.png" },
  { id: "ethan", name: "Ethan", gender: "male", initial: "E", accent: "#5FAE96", facePath: "assets/Ethan_Assets/Ethan_face.png" },
  { id: "jayden", name: "Jayden", gender: "male", initial: "J", accent: "#D4719B", facePath: "assets/Jayden_Assets/Jayden_face.png" },
];

export function companionsFor(gender: "female" | "male"): Companion[] {
  return COMPANIONS.filter((c) => c.gender === gender);
}

export function companionById(id: string): Companion | undefined {
  return COMPANIONS.find((c) => c.id === id);
}

export function companionByName(name: string): Companion | undefined {
  return COMPANIONS.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
