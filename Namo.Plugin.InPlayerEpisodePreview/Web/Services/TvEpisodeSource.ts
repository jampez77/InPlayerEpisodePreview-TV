import type {BaseItemDto} from '@jellyfin/sdk/lib/generated-client';

export type TvEpisode = {
    id: string
    name: string
    seriesName: string
    seasonName: string
    seasonNumber: number | null
    episodeNumber: number | null
    episodeNumberEnd?: number | null
    description: string
    imageUrl: string | null
    runtimeTicks: number
    playbackPositionTicks: number
    played: boolean
};

export type TvEpisodeList = {
    episodes: TvEpisode[]
    activeIndex: number
};

// The extra flags exist on some server versions, while others only expose LocationType.
type EpisodeDto = BaseItemDto & {IsMissing?: boolean; IsVirtualItem?: boolean};
type AvailableEpisodeDto = EpisodeDto & {Id: string};
const PAGE_SIZE = 200;
const MAX_PAGES = 100;

/** Wrap in both directions, including a single-episode show. Empty lists have no index. */
export function wrappedIndex(index: number, direction: number, length: number): number {
    if (!Number.isInteger(length) || length <= 0) return -1;
    if (!Number.isFinite(index) || !Number.isFinite(direction)) return -1;
    return ((Math.trunc(index) + Math.trunc(direction)) % length + length) % length;
}

export function episodePositionLabel(episode: TvEpisode): string {
    const season = episode.seasonNumber === 0 ? 'Specials'
        : episode.seasonNumber !== null ? `Season ${episode.seasonNumber}`
            : episode.seasonName || 'Unknown season';
    const end = episode.episodeNumberEnd;
    const number = episode.episodeNumber;
    const episodeLabel = number === null ? 'Unnumbered episode'
        : end !== undefined && end !== null && end > number
            ? `Episodes ${number}–${end}` : `Episode ${number}`;
    return `${season} · ${episodeLabel}`;
}

function indexNumber(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function availableEpisode(item: EpisodeDto, seriesId: string): item is AvailableEpisodeDto {
    return Boolean(item.Id)
        && item.Type === 'Episode'
        && (!item.SeriesId || item.SeriesId === seriesId)
        && item.LocationType !== 'Virtual'
        && !item.IsMissing
        && !item.IsVirtualItem
        && !item.IsPlaceHolder;
}

function compareNumber(a: number | null, b: number | null): number {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
}

function compareEpisodes(a: TvEpisode, b: TvEpisode): number {
    return compareNumber(a.seasonNumber, b.seasonNumber)
        || compareNumber(a.episodeNumber, b.episodeNumber)
        || a.name.localeCompare(b.name, undefined, {numeric: true})
        || a.id.localeCompare(b.id);
}

function requestError(action: string, error: unknown): Error {
    const status = (error as {status?: number; statusCode?: number})?.status
        ?? (error as {statusCode?: number})?.statusCode;
    if (status === 401 || status === 403) {
        return new Error(`Unable to ${action}. Sign in to Jellyfin again and check access to this show.`);
    }
    if (status === 404) {
        return new Error(`Unable to ${action}. This show may have moved or been removed; refresh your library and try again.`);
    }
    return new Error(`Unable to ${action}. Check your connection to Jellyfin and try opening the episode browser again.`);
}

/** Read the complete show using the signed-in web client's existing server and credentials. */
export class TvEpisodeSource {
    async load(itemId: string, playingItem?: BaseItemDto): Promise<TvEpisodeList> {
        if (!itemId) throw new Error('No playing episode was found. Start an episode and try again.');
        if (typeof ApiClient === 'undefined' || !ApiClient.getCurrentUserId()) {
            throw new Error('Sign in to Jellyfin before opening the episode browser.');
        }
        const userId = ApiClient.getCurrentUserId();
        let current: EpisodeDto;
        try {
            current = playingItem ?? await ApiClient.getItem(userId, itemId);
        } catch (error) {
            throw requestError('load the playing episode', error);
        }
        if (!current || current.Type !== 'Episode' || !current.SeriesId || !current.Id) {
            throw new Error('Episode browsing is available while playing a TV episode. Start an episode and try again.');
        }
        const seriesId = current.SeriesId;
        if (!availableEpisode(current, seriesId)) {
            throw new Error('This episode is unavailable in your library. Refresh the library and play an available episode.');
        }

        const [items, seasons] = await Promise.all([
            this.loadEpisodes(seriesId, userId),
            this.loadSeasons(seriesId, userId)
        ]);
        const seasonById = new Map<string, BaseItemDto>();
        const seasonByNumber = new Map<number, BaseItemDto>();
        for (const season of seasons) {
            if (season.Id) seasonById.set(season.Id, season);
            const number = indexNumber(season.IndexNumber);
            if (number !== null) seasonByNumber.set(number, season);
        }
        const uniqueItems = new Map<string, AvailableEpisodeDto>();
        for (const item of items) {
            if (availableEpisode(item, seriesId) && !uniqueItems.has(item.Id)) uniqueItems.set(item.Id, item);
        }
        if (!uniqueItems.size) {
            throw new Error('No available episodes were returned for this show. Refresh your library and try again.');
        }
        // A playing alternate version, or a library update between requests, can omit the
        // active Id from the list. getItem already confirmed that it is a real episode.
        if (!uniqueItems.has(current.Id)) uniqueItems.set(current.Id, current);

        const episodes = Array.from(uniqueItems.values()).map(item => {
            const season = seasonById.get(item.SeasonId || '')
                ?? (item.ParentIndexNumber != null ? seasonByNumber.get(item.ParentIndexNumber) : undefined);
            const seasonNumber = indexNumber(item.ParentIndexNumber) ?? indexNumber(season?.IndexNumber);
            const seasonName = season?.Name || item.SeasonName
                || (seasonNumber === 0 ? 'Specials' : seasonNumber !== null ? `Season ${seasonNumber}` : 'Unknown season');
            const imageType = item.ImageTags?.Primary ? 'Primary' : item.ImageTags?.Thumb ? 'Thumb' : null;
            const runtimeTicks = Math.max(0, item.RunTimeTicks || 0);
            return {
                id: item.Id,
                name: item.Name || 'Untitled episode',
                seriesName: item.SeriesName || current.SeriesName || 'TV show',
                seasonName,
                seasonNumber,
                episodeNumber: indexNumber(item.IndexNumber),
                episodeNumberEnd: indexNumber(item.IndexNumberEnd),
                description: item.Overview || '',
                imageUrl: imageType ? ApiClient.getImageUrl(item.Id, {
                    type: imageType,
                    tag: item.ImageTags?.[imageType],
                    maxWidth: 960,
                    quality: 90
                }) : null,
                runtimeTicks,
                playbackPositionTicks: Math.max(0, item.UserData?.PlaybackPositionTicks || 0),
                played: item.UserData?.Played === true
            };
        }).sort(compareEpisodes);

        return {episodes, activeIndex: episodes.findIndex(episode => episode.id === current.Id)};
    }

    private async loadSeasons(seriesId: string, userId: string): Promise<BaseItemDto[]> {
        try {
            // Jellyfin's season endpoint returns the whole list and does not accept paging.
            const result = await ApiClient.getSeasons(seriesId, {
                UserId: userId,
                IsMissing: false,
                EnableImages: false,
                EnableUserData: false
            });
            if (!Array.isArray(result?.Items)) throw new Error('Invalid seasons response');
            return result.Items;
        } catch (error) {
            throw requestError('load season names', error);
        }
    }

    private async loadEpisodes(seriesId: string, userId: string): Promise<EpisodeDto[]> {
        const items: EpisodeDto[] = [];
        const seen = new Set<string>();
        let startIndex = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
            let result;
            try {
                // Omitting Season/SeasonId is intentional: a single list spans the show.
                result = await ApiClient.getEpisodes(seriesId, {
                    UserId: userId,
                    Fields: 'Overview',
                    IsMissing: false,
                    EnableImages: true,
                    EnableImageTypes: 'Primary,Thumb',
                    EnableUserData: true,
                    StartIndex: startIndex,
                    Limit: PAGE_SIZE
                });
            } catch (error) {
                throw requestError('load this show’s episodes', error);
            }
            if (!Array.isArray(result?.Items)) {
                throw new Error('Jellyfin returned an invalid episode list. Refresh the library and try again.');
            }
            const batch: EpisodeDto[] = result.Items;
            const total = indexNumber(result.TotalRecordCount);
            if (batch.length === 0) {
                if (total !== null && startIndex < total) {
                    throw new Error('Jellyfin returned an incomplete episode list. Refresh the library and try again.');
                }
                return items;
            }
            const previousSize = seen.size;
            for (const item of batch) if (item.Id) seen.add(item.Id);
            if (seen.size === previousSize) {
                throw new Error('Jellyfin repeated an episode page. Refresh the library and try again.');
            }
            items.push(...batch);
            startIndex += batch.length;
            if (total !== null ? startIndex >= total : batch.length < PAGE_SIZE) return items;
        }
        throw new Error('This show’s episode list exceeded the browsing limit. Check for duplicate library entries and try again.');
    }
}
