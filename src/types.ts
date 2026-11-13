export type Experience = {
  company: string;
  role: string;
  period: string;
  detail: string;
};

export type Resume = {
  id: string;
  name: string;
  role: string;
  location: string;
  received: string;
  initials: string;
  source: "demo" | "pdf";
  text: string;
  experiences?: Experience[];
  education: string;
  skills: string[];
  summary?: string;
  fileName?: string;
  pages?: number;
  size?: number;
};
