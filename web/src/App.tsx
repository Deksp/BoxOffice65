import { useRef, useState, useEffect } from "react";
import "./App.css";

type Film = {
  _id: string;
  title: string;
  titleRu?: string;
  releaseYear?: number;
  poster?: { provider: "tmdb"; path: string } | null;
  external?: { tmdbId?: number; tmdbUrl?: string; kinopoiskUrl?: string };
};

type LibraryFilm = Film;
// Library films may contain offline metrics-like fields (filled by python script)
type LibraryFilmWithStats = LibraryFilm & {
  money?: {
    budgetUsd?: { selected?: number };
    grossWorldwideUsd?: { selected?: number };
    grossDomesticUsd?: { selected?: number };
  };
  ratings?: {
    tmdb?: { selected?: number };
  };
};

type Metric = {
  year: number;
  money?: {
    budgetUsd?: { selected?: number };
    grossWorldwideUsd?: { selected?: number };
  };
  ratings?: {
    tmdb?: { selected?: number };
  };
};

type YearCard = {
  _id?: string;
  year: number;
  notes?: string;
  winners?: Record<string, unknown>;
};

type YearDetails = {
  yearCard: YearCard;
  winners: {
    topWorldwide?: { film: Film; metrics?: Metric | null } | null;
    mostExpensive?: { film: Film; metrics?: Metric | null } | null;
    topDomestic?: { film: Film; metrics?: Metric | null } | null;
  };
};

type Insight = {
  _id: string;
  year?: number | null;
  filmIds: string[];
  title: string;
  text: string;
  tags: string[];
};

async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

async function apiDelete<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    method: "DELETE",
    headers: { "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

function fmtMoney(v?: number) {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) + " $";
}

function fmtRating(v?: number) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(1);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function posterUrl(f?: Film) {
  const p = f?.poster?.path;
  if (!p) return null;
  return `https://image.tmdb.org/t/p/w342${p}`;
}

type TabKey = "years" | "films" | "add";

export default function App() {
  const [tab, setTab] = useState<TabKey>("years");

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const years = availableYears;

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [yearDetails, setYearDetails] = useState<YearDetails | null>(null);
  const [yearInsights, setYearInsights] = useState<Insight[]>([]);
  const [loadingYear, setLoadingYear] = useState(false);
  const [yearErr, setYearErr] = useState<string | null>(null);
  const [rebuildingYears, setRebuildingYears] = useState(false);

  // Films view state
  const [filmQ, setFilmQ] = useState("");
  const [filmYear, setFilmYear] = useState<number | "all">("all");
  const [filmSort, setFilmSort] = useState<"year" | "title">("year");
  const [filmDir, setFilmDir] = useState<"desc" | "asc">("desc");
  const [films, setFilms] = useState<{ film: Film; metric: Metric | null }[]>([]);
  const [loadingFilms, setLoadingFilms] = useState(false);
  const [filmsErr, setFilmsErr] = useState<string | null>(null);

  // Add film state
  const [tmdbId, setTmdbId] = useState<string>("");
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Library films (secondary DB)
  const [libraryQ, setLibraryQ] = useState("");
  const [libraryFilms, setLibraryFilms] = useState<LibraryFilmWithStats[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryErr, setLibraryErr] = useState<string | null>(null);

  const mainScrollRef = useRef<HTMLElement>(null);

  // Сброс скролла при переключении вкладок или года
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, selectedYear]);

  // Загрузка списка годов
  useEffect(() => {
    apiGet<number[]>("/api/years")
      .then((ys) => {
        setAvailableYears(ys);
        // Если ничего не выбрано, выбираем последний (самый свежий)
        if (ys.length > 0 && selectedYear === null) {
          setSelectedYear(ys[0]);
        }
      })
      .catch((e) => console.error("Failed to load years", e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Запускаем загрузку фильмов сразу
  useEffect(() => {
    void loadFilms();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load library list when opening the "add" tab
  useEffect(() => {
    if (tab === "add") void loadLibrary();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // При изменении selectedYear подгружаем данные
  useEffect(() => {
    if (selectedYear) {
      void loadYear(selectedYear);
    }
  }, [selectedYear]);

  async function loadYear(y: number) {
    setLoadingYear(true);
    setYearErr(null);
    try {
      const details = await apiGet<YearDetails>(`/api/years/${y}/details`);
      const insights = await apiGet<Insight[]>(`/api/years/${y}/insights`);
      setYearDetails(details);
      setYearInsights(insights);
    } catch (e: unknown) {
      setYearErr(errMsg(e));
      setYearDetails(null);
      setYearInsights([]);
    } finally {
      setLoadingYear(false);
    }
  }

  async function reloadYearsList() {
    const ys = await apiGet<number[]>("/api/years");
    setAvailableYears(ys);
    return ys;
  }

  async function rebuildYearsFromDb() {
    setYearErr(null);
    setRebuildingYears(true);
    try {
      await apiPost(`/api/admin/years/rebuild`, {});
      const ys = await reloadYearsList();
      const y = selectedYear ?? ys[0] ?? null;
      if (y != null) {
        setSelectedYear(y);
        await loadYear(y);
      }
    } catch (e: unknown) {
      setYearErr(errMsg(e));
    } finally {
      setRebuildingYears(false);
    }
  }

  async function loadFilms() {
    setLoadingFilms(true);
    setFilmsErr(null);
    try {
      const params = new URLSearchParams();
      if (filmQ.trim()) params.set("q", filmQ.trim());
      if (filmYear !== "all") params.set("year", String(filmYear));
      params.set("sort", filmSort);
      params.set("dir", filmDir);
      params.set("limit", "300");
      params.set("withMetrics", "1");

      const r = await apiGet<{ items: { film: Film; metric: Metric | null }[] }>(
        `/api/films?${params.toString()}`
      );
      setFilms(r.items ?? []);
    } catch (e: unknown) {
      setFilmsErr(errMsg(e));
      setFilms([]);
    } finally {
      setLoadingFilms(false);
    }
  }

  async function doImport() {
    setAddErr(null);
    setAddStatus(null);

    const id = Number(tmdbId);
    if (!Number.isFinite(id)) {
      setAddErr("TMDb ID должен быть числом.");
      return;
    }

    setAdding(true);
    try {
      const r = await apiPost<{ ok: boolean; yearUpdated?: number }>(`/api/admin/films/import-tmdb`, {
        tmdbId: id,
      });
      setAddStatus(r.yearUpdated ? `Фильм импортирован. Пересчитан год: ${r.yearUpdated}.` : "Фильм импортирован.");
      // обновим текущие экраны
      await loadFilms();
      if (r.yearUpdated) {
        // Если года еще нет в списке, добавляем его (оптимистично)
        if (!availableYears.includes(r.yearUpdated)) {
           setAvailableYears(prev => [...prev, r.yearUpdated!].sort((a,b) => b-a));
        }
        setSelectedYear(r.yearUpdated);
        await loadYear(r.yearUpdated);
        setTab("years");
      }
    } catch (e: unknown) {
      setAddErr(errMsg(e));
    } finally {
      setAdding(false);
    }
  }

  async function loadLibrary() {
    setLoadingLibrary(true);
    setLibraryErr(null);
    try {
      const params = new URLSearchParams();
      if (libraryQ.trim()) params.set("q", libraryQ.trim());
      params.set("limit", "200");
      params.set("excludeMain", "1");
      const r = await apiGet<{ items: LibraryFilmWithStats[] }>(`/api/library/films?${params.toString()}`);
      setLibraryFilms(r.items ?? []);
    } catch (e: unknown) {
      setLibraryErr(errMsg(e));
      setLibraryFilms([]);
    } finally {
      setLoadingLibrary(false);
    }
  }

  async function importFromLibrary(id: string) {
    setAddErr(null);
    setAddStatus(null);
    setAdding(true);
    try {
      await apiPost(`/api/library/films/${id}/import`, {});
      setAddStatus("Фильм добавлен в основную базу.");
      await loadFilms();
      await reloadYearsList(); // чтобы новые года появлялись в UI без перезапуска
      await loadLibrary(); // чтобы сразу исчез из списка (excludeMain=1)
    } catch (e: unknown) {
      setAddErr(errMsg(e));
    } finally {
      setAdding(false);
    }
  }

  async function doDelete(id: string) {
    if (!confirm("Удалить фильм и его метрики?")) return;
    try {
      await apiDelete(`/api/admin/films/${id}`);
      setFilms((prev) => prev.filter((f) => f.film._id !== id));
    } catch (e: unknown) {
      alert("Ошибка удаления: " + errMsg(e));
    }
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">BoxOffice65</div>
          <div className="brandDesc">
            Проект сравнивает по каждому году самый кассовый фильм и самый дорогой по бюджету.
            База расширяемая: можно добавлять фильмы вручную (через TMDb ID), а победители пересчитываются автоматически.
          </div>
          <ul className="brandBullets">
            <li>Кассовый победитель vs самый дорогой</li>
            <li>Рейтинги и ссылки (TMDb / КП)</li>
            <li>Автопересчёт победителей года</li>
            <li>Интересные факты для отдельных лет</li>
          </ul>
        </div>

        <nav className="tabs">
          <button className={tab === "years" ? "tab active" : "tab"} onClick={() => setTab("years")}>Годы</button>
          <button className={tab === "films" ? "tab active" : "tab"} onClick={() => setTab("films")}>Фильмы</button>
          <button className={tab === "add" ? "tab active" : "tab"} onClick={() => setTab("add")}>Добавить</button>
        </nav>
      </header>

      <main ref={mainScrollRef} className="content">
        {tab === "years" && (
          <section className="grid2">
            <aside className="panel">
              <div className="panelHeader">
                <div className="panelTitle">Годы</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => selectedYear && loadYear(selectedYear)}
                    disabled={loadingYear || !selectedYear}
                  >
                    Обновить
                  </button>
                  <button className="btn" onClick={rebuildYearsFromDb} disabled={rebuildingYears}>
                    {rebuildingYears ? "Строю…" : "Построить годы"}
                  </button>
                </div>
              </div>

              <div className="yearsList">
                {years.map((y) => (
                  <button
                    key={y}
                    className={y === selectedYear ? "yearItem active" : "yearItem"}
                    onClick={() => {
                      setSelectedYear(y);
                      // void loadYear(y); // useEffect сам подгрузит
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </aside>

            <section className="panel">
              <div className="panelHeader">
                <div className="panelTitle">Карточка года: {selectedYear ?? "—"}</div>
                {loadingYear && <span className="muted">Загрузка…</span>}
              </div>

              <div className="panel-scroll">
                {yearErr && (
                  <div className="error">
                    {yearErr.includes("404") ? (
                      <div>
                        Год ещё не заполнен данными. <br/>
                        Попробуйте <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => selectedYear && loadYear(selectedYear)}>обновить</span> или импортировать фильмы.
                      </div>
                    ) : yearErr}
                  </div>
                )}

                {!yearErr && !loadingYear && !yearDetails && selectedYear && (
                   <div className="muted">Нет данных.</div>
                )}

                {!yearErr && yearDetails && (
                  <>
                    <div className="cards2">
                      <WinnerCard
                        label="Самый кассовый"
                        item={yearDetails.winners?.topWorldwide ?? null}
                      />
                      <WinnerCard
                        label="Самый дорогой"
                        item={yearDetails.winners?.mostExpensive ?? null}
                      />
                    </div>

                    <div className="block">
                      <div className="blockTitle">Интересные факты</div>
                      {yearInsights.length === 0 ? (
                        <div className="muted">Пока нет заметок для этого года.</div>
                      ) : (
                        <div className="insights">
                          {yearInsights.map((it) => (
                            <div className="insight" key={it._id}>
                              <div className="insightTitle">
                                {it.title}
                                {it.tags?.length ? (
                                  <span className="tags">
                                    {it.tags.slice(0, 3).map((t) => (
                                      <span className="tag" key={t}>{t}</span>
                                    ))}
                                  </span>
                                ) : null}
                              </div>
                              <div className="insightText">{it.text}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>
          </section>
        )}

        {tab === "films" && (
          <section className="panel tab-view">
            <div className="panelHeader">
              <div className="panelTitle">Все фильмы</div>
              <div className="row">
                <button className="btn" onClick={() => loadFilms()} disabled={loadingFilms}>
                  Обновить
                </button>
              </div>
            </div>

            <div className="filters">
              {/* Filters content */}
              <label className="field">
                <div className="fieldLabel">Поиск</div>
                <input
                  className="input"
                  value={filmQ}
                  onChange={(e) => setFilmQ(e.target.value)}
                  placeholder="например: Аватар, ВК, Шрек…"
                />
              </label>

              <label className="field">
                <div className="fieldLabel">Год</div>
                <select
                  className="select"
                  value={filmYear}
                  onChange={(e) => setFilmYear(e.target.value === "all" ? "all" : Number(e.target.value))}
                >
                  <option value="all">Все</option>
                  {years.slice().reverse().map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <div className="fieldLabel">Сортировка</div>
                <select className="select" value={filmSort} onChange={(e) => setFilmSort(e.target.value as "year" | "title")}>
                  <option value="year">Год</option>
                  <option value="title">Название</option>
                </select>
              </label>

              <label className="field">
                <div className="fieldLabel">Направление</div>
                <select className="select" value={filmDir} onChange={(e) => setFilmDir(e.target.value as "desc" | "asc")}>
                  <option value="desc">По убыванию</option>
                  <option value="asc">По возрастанию</option>
                </select>
              </label>

              <button
                className="btn primary"
                onClick={() => loadFilms()}
                disabled={loadingFilms}
                title="Применить фильтры"
              >
                Применить
              </button>
            </div>

            {filmsErr && <div className="error">{filmsErr}</div>}

            <div className="panel-scroll">
              <div className="table">
                <div className="thead">
                  <div></div>
                  <div>Фильм</div>
                  <div>Год</div>
                  <div>Бюджет</div>
                  <div>Сборы</div>
                  <div>Рейтинг</div>
                  <div style={{ textAlign: "right" }}>Действия</div>
                </div>

                {films.map(({ film, metric }) => {
                  const img = posterUrl(film);
                  const budget = metric?.money?.budgetUsd?.selected;
                  const revenue = metric?.money?.grossWorldwideUsd?.selected;
                  const rating = metric?.ratings?.tmdb?.selected;

                  return (
                    <div className="trow" key={film._id}>
                      <div className="posterCell">
                        {img ? <img className="posterSm" src={img} alt="" /> : <div className="posterPh sm" />}
                      </div>
                      <div className="filmCell">
                        <div className="filmTitle">{film.titleRu || film.title}</div>
                        {film.titleRu && film.titleRu !== film.title && (
                          <div className="muted">{film.title}</div>
                        )}
                      </div>
                      <div>{film.releaseYear ?? "—"}</div>
                      <div>{fmtMoney(budget)}</div>
                      <div>{fmtMoney(revenue)}</div>
                      <div>{fmtRating(rating)}</div>
                      <div className="links" style={{ justifyContent: "flex-end" }}>
                        {film.external?.tmdbUrl && (
                          <a className="link" href={film.external.tmdbUrl} target="_blank" rel="noreferrer">
                            TMDb
                          </a>
                        )}
                        {film.external?.kinopoiskUrl && (
                          <a className="link" href={film.external.kinopoiskUrl} target="_blank" rel="noreferrer">
                            КП
                          </a>
                        )}
                        <button
                          className="btn"
                          style={{ padding: "4px 8px", fontSize: "11px", marginLeft: 6, color: "#fb7185", borderColor: "rgba(251,113,133,0.3)" }}
                          onClick={() => doDelete(film._id)}
                          title="Удалить фильм"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}

                {films.length === 0 && !filmsErr && (
                  <div className="empty">Ничего не найдено.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === "add" && (
          <section className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Добавить фильм</div>
              <div className="muted">Импорт по TMDb ID. После импорта год пересчитывается автоматически.</div>
            </div>

            <div className="addGrid">
              <label className="field">
                <div className="fieldLabel">TMDb ID</div>
                <input
                  className="input"
                  value={tmdbId}
                  onChange={(e) => setTmdbId(e.target.value)}
                  placeholder="например: 634649 (Spider-Man: No Way Home)"
                />
              </label>

              <button className="btn primary" onClick={() => doImport()} disabled={adding}>
                {adding ? "Импорт…" : "Импортировать"}
              </button>
            </div>

            {addErr && <div className="error">{addErr}</div>}
            {addStatus && <div className="ok">{addStatus}</div>}

            <div className="block">
              <div className="blockTitle">Подсказка</div>
              <div className="muted">
                TMDb ID можно взять из ссылки фильма в TMDb: <span className="mono">/movie/&lt;ID&gt;</span>.
              </div>
            </div>

            <div className="block libraryBlock">
              <div className="blockTitle">Библиотека фильмов (офлайн)</div>

              <div className="row">
                <input
                  className="input"
                  value={libraryQ}
                  onChange={(e) => setLibraryQ(e.target.value)}
                  placeholder="Поиск в библиотеке…"
                />
                <button className="btn" onClick={() => void loadLibrary()} disabled={loadingLibrary}>
                  {loadingLibrary ? "Загрузка…" : "Обновить список"}
                </button>
              </div>

              {libraryErr && <div className="error">{libraryErr}</div>}

              {!libraryErr && !loadingLibrary && libraryFilms.length === 0 && (
                <div className="muted">
                  В библиотеке пока нет фильмов. Наполни коллекцию <span className="mono">libraryfilms</span> своим скриптом,
                  затем импортируй их в основную базу этой кнопкой.
                </div>
              )}

              {libraryFilms.length > 0 && (
                <div className="libraryTableScroll">
                  <div className="table libraryTable">
                    <div className="thead">
                      <div />
                      <div>Фильм</div>
                      <div>Год</div>
                      <div>Бюджет</div>
                      <div>Сборы</div>
                      <div>Рейтинг</div>
                      <div>Ссылки</div>
                      <div />
                    </div>

                    {libraryFilms.map((f) => {
                      const img = posterUrl(f);
                      const budget = f.money?.budgetUsd?.selected;
                      const revenue = f.money?.grossWorldwideUsd?.selected;
                      const rating = f.ratings?.tmdb?.selected;
                      return (
                        <div className="trow" key={f._id}>
                          <div className="posterCell">
                            {img ? <img className="posterSm" src={img} alt="" /> : <div className="posterPh sm" />}
                          </div>
                          <div className="filmCell">
                            <div className="filmTitle">{f.titleRu || f.title}</div>
                            {f.titleRu && f.titleRu !== f.title && <div className="muted">{f.title}</div>}
                          </div>
                          <div>{f.releaseYear ?? "—"}</div>
                          <div>{fmtMoney(budget)}</div>
                          <div>{fmtMoney(revenue)}</div>
                          <div>{fmtRating(rating)}</div>
                          <div className="links">
                            {f.external?.tmdbUrl && (
                              <a className="link" href={f.external.tmdbUrl} target="_blank" rel="noreferrer">
                                TMDb
                              </a>
                            )}
                            {f.external?.kinopoiskUrl && (
                              <a className="link" href={f.external.kinopoiskUrl} target="_blank" rel="noreferrer">
                                КП
                              </a>
                            )}
                          </div>
                          <div className="libActionCell">
                            <button className="btn" onClick={() => void importFromLibrary(f._id)} disabled={adding}>
                              Добавить в основную
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function WinnerCard(props: { label: string; item: { film: Film; metrics?: Metric | null } | null }) {
  const film = props.item?.film ?? null;
  const metric = props.item?.metrics ?? null;

  const img = film ? posterUrl(film) : null;
  const budget = metric?.money?.budgetUsd?.selected;
  const revenue = metric?.money?.grossWorldwideUsd?.selected;
  const rating = metric?.ratings?.tmdb?.selected;

  return (
    <div className="card">
      <div className="cardLabel">{props.label}</div>

      {!film ? (
        <div className="muted">Нет данных</div>
      ) : (
        <div className="cardBody">
          <div className="posterWrap">
            {img ? <img className="poster" src={img} alt="" /> : <div className="posterPh big" />}
          </div>

          <div className="cardInfo">
            <div className="cardTitle">{film.titleRu || film.title}</div>
            {film.titleRu && film.titleRu !== film.title && (
              <div className="muted">{film.title}</div>
            )}
            <div className="metaRow">
              <div className="metaItem"><span className="metaKey">Год</span> {film.releaseYear ?? "—"}</div>
              <div className="metaItem"><span className="metaKey">Рейтинг</span> {fmtRating(rating)}</div>
            </div>

            <div className="metaRow">
              <div className="metaItem"><span className="metaKey">Бюджет</span> {fmtMoney(budget)}</div>
              <div className="metaItem"><span className="metaKey">Сборы</span> {fmtMoney(revenue)}</div>
            </div>

            <div className="links">
              {film.external?.tmdbUrl && (
                <a className="link" href={film.external.tmdbUrl} target="_blank" rel="noreferrer">TMDb</a>
              )}
              {film.external?.kinopoiskUrl && (
                <a className="link" href={film.external.kinopoiskUrl} target="_blank" rel="noreferrer">КП</a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
