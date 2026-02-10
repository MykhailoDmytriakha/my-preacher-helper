import { TFunction } from 'i18next';
import { useMemo } from 'react';

import { Sermon } from '@/models/models';
import { getEffectiveIsPreached, getLatestPreachedDate } from '@/utils/preachDateStatus';
import { getThoughtSnippets, matchesSermonQuery, tokenizeQuery, ThoughtSnippet } from '@/utils/sermonSearch';

type FilterOptions = {
    searchQuery: string;
    searchInThoughts: boolean;
    searchInTags: boolean;
    sortOption: "newest" | "oldest" | "alphabetical";
    seriesFilter: "all" | "inSeries" | "standalone";
    activeTab: "active" | "preached" | "all";
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
    const { searchQuery, searchInThoughts, searchInTags, sortOption, seriesFilter, activeTab } = options;

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

        // Series filter
        if (seriesFilter === "inSeries") {
            filtered = filtered.filter((sermon) => sermon.seriesId);
        } else if (seriesFilter === "standalone") {
            filtered = filtered.filter((sermon) => !sermon.seriesId);
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
    }, [sermons, searchTokens, searchOptions, sortOption, seriesFilter, activeTab, searchQuery, t]);
}
