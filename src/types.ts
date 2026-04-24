export interface Tip {
  id: number;
  slug: string;
  title: string;
  url: string;
  source: "blog" | "newsletter";
  published: string;
  tags: string[];
  excerpt: string | null;
  contentMd: string;
  fetchedAt: string;
}

export interface SearchHit {
  id: number;
  title: string;
  url: string;
  published: string;
  source: "blog" | "newsletter";
  snippet: string;
  score: number;
}
