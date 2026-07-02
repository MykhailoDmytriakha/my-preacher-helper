import { TFunction } from 'i18next';
import { useMemo } from 'react';

import { Sermon } from '@/models/models';
import { getEffectiveIsPreached, getLatestPreachedDate } from '@/utils/preachDateStatus';
import { getThoughtSnippets, matchesSermonQuery, tokenizeQuery, ThoughtSnippet } from '@/utils/sermonSearch';

type FilterOptions = {
    searchQuery: string;
    searchInThoughts: boolean;
    searchInTags: boolean;
    sortOption: "newest" | "oldest" | "alphabetical" | "recentlyUpdated";
    seriesFilter: "all" | "inSeries" | "standalone";
    activeTab: "active" | "preached" | "all";
    /**
     * Set of sermon ids that are members of ANY series — DERIVED by the caller
     * from the loaded series list (series.items is the sole truth). The filter
     * consults this set instead of the deprecated sermon.seriesId back-ref.
     */
    inSeriesRefIds?: Set<string>;
};

const getLatestPreachTimestamp = (sermon: Sermon) => {
    const latestPreachedDate = getLatestPreachedDate(sermon);
    if (!latestPreachedDate?.date) {
        return null;
    }

    const timestamp = new Date(latestPreachedDate.date).getTime();
    if (Number.isNaN(timestamp)) {
        return null;
    }

    return timestamp;
};

const getSortTimestamp = (sermon: Sermon) => {
    const preachedTimestamp = getLatestPreachTimestamp(sermon);
    if (preachedTimestamp !== null) {
        return preachedTimestamp;
    }

    return new Date(sermon.date).getTime();
};

export function useFilteredSermons(
    sermons: Sermon[],
    options: FilterOptions,
    t: TFunction
) {
    const { searchQuery, searchInThoughts, searchInTags, sortOption, seriesFilter, activeTab, inSeriesRefIds } = options;

    const searchTokens = useMemo(() => tokenizeQuery(searchQuery), [searchQuery]);

    const searchOptions = useMemo(
        () => ({
            searchInTitleVerse: true,
            searchInThoughts,
            searchInTags,
        }),
        [searchInThoughts, searchInTags]
    );

    return useMemo(() => {
        let filtered = [...sermons];

        // Series filter — derived from series.items membership (via the injected
        // set), not the deprecated sermon.seriesId back-ref.
        if (seriesFilter === "inSeries") {
            filtered = filtered.filter((sermon) => inSeriesRefIds?.has(sermon.id));
        } else if (seriesFilter === "standalone") {
            filtered = filtered.filter((sermon) => !inSeriesRefIds?.has(sermon.id));
        }

        // Tab filter (Active vs Preached vs All)
        if (activeTab === "active") {
            filtered = filtered.filter((sermon) => !getEffectiveIsPreached(sermon));
        } else if (activeTab === "preached") {
            filtered = filtered.filter((sermon) => getEffectiveIsPreached(sermon));
        }

        // Search filter
        if (searchTokens.length) {
            filtered = filtered.filter((sermon) =>
                matchesSermonQuery(sermon, searchTokens, searchOptions, t)
            );
        }

        const sorted = filtered.sort((a, b) => {
            switch (sortOption) {
                case "newest":
                    return getSortTimestamp(b) - getSortTimestamp(a);
                case "oldest":
                    return getSortTimestamp(a) - getSortTimestamp(b);
                case "alphabetical":
                    return a.title.localeCompare(b.title);
                case "recentlyUpdated": {
                    const aTime = new Date(a.updatedAt ?? a.date).getTime();
                    const bTime = new Date(b.updatedAt ?? b.date).getTime();
                    return bTime - aTime;
                }
                default:
                    return 0;
            }
        });

        const snippets: Record<string, ThoughtSnippet[] | undefined> = {};
        if (searchTokens.length) {
            sorted.forEach((sermon) => {
                const thoughtSnippets = getThoughtSnippets(sermon, searchQuery, Infinity, 90, undefined, t);
                if (thoughtSnippets.length > 0) {
                    snippets[sermon.id] = thoughtSnippets;
                }
            });
        }

        return { processedSermons: sorted, searchSnippetsById: snippets, activeFilterCount: 0 }; // Added dummy activeFilterCount for now or calculate here?
    }, [sermons, searchTokens, searchOptions, sortOption, seriesFilter, activeTab, searchQuery, inSeriesRefIds, t]);
}
