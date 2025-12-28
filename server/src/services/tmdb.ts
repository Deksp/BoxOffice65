import fetch from "node-fetch";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.TMDB_API_KEY || "3b47ed2b0801a9e3132811b9ae8ee391";

export type TMDbMovieDetails = {
  id: number;
  title?: string; // RU title if language=ru-RU
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  budget?: number;
  revenue?: number;
  vote_average?: number;
};

async function tmdbGet<T>(path: string, params: Record<string, string>) {


  const url = new URL(TMDB_API + path);
  url.searchParams.set("api_key", TMDB_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Если 401/404 - прокидываем их как есть, чтобы роут мог обработать
    if (res.status >= 400 && res.status < 500) {
      throw { status: res.status, message: `TMDb error ${res.status}: ${text.slice(0, 300)}` };
    }
    throw new Error(`TMDb error ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function tmdbMovieDetails(tmdbId: number): Promise<TMDbMovieDetails> {
  return await tmdbGet<TMDbMovieDetails>(`/movie/${tmdbId}`, { language: "ru-RU" });
}
