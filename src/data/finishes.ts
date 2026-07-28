export interface Finish {
  id: string;
  name: string;
  color: string;
  roughness: number;
}

export const finishes: Finish[] = [
  { id: "yellow-gold", name: "Yellow Gold", color: "#f2cf76", roughness: 0.24 },
  { id: "rose-gold", name: "Rose Gold", color: "#f0b79c", roughness: 0.26 },
  { id: "white-gold", name: "White Gold", color: "#ecebe6", roughness: 0.2 },
  { id: "platinum", name: "Platinum", color: "#dadbe0", roughness: 0.22 },
  { id: "silver", name: "Silver", color: "#cfd0d4", roughness: 0.18 },
];
