import type {BaseItemDto} from '@jellyfin/sdk/lib/generated-client';
import {TvEpisodeSource, type TvEpisode} from './TvEpisodeSource';

export type TvMediaKind = 'episode' | 'movie' | 'channel';
export type TvMediaItem = TvEpisode & {
    kind: TvMediaKind
    productionYear?: number
    genres?: string[]
    officialRating?: string
    channelNumber?: string
    programName?: string
    programStart?: string
    programEnd?: string
};
export type TvMediaList = {
    items: TvMediaItem[]
    activeIndex: number
    kind: TvMediaKind
    playingItemId: string
};

/** Disabled media types should quietly return control to Jellyfin instead of showing a loading error. */
export class TvMediaDisabledError extends Error {
    constructor() {
        super('Browsing is disabled for this media type.');
        this.name = 'TvMediaDisabledError';
    }
}

type MediaDto = BaseItemDto & {IsMissing?: boolean; IsVirtualItem?: boolean};
type AvailableDto = MediaDto & {Id: string};
const SIMILAR_LIMIT = 30;
const CHANNEL_PAGE_SIZE = 200;
const MAX_CHANNEL_PAGES = 100;

function available(item: MediaDto, type: 'Movie' | 'TvChannel'): item is AvailableDto {
    if (!item?.Id || item.Type !== type || item.IsFolder || item.PlayAccess === 'None') return false;
    // Live streams do not need a local library file; the channel endpoint applies user access.
    return type === 'TvChannel' || (item.LocationType !== 'Virtual'
        && !item.IsMissing && !item.IsVirtualItem && !item.IsPlaceHolder);
}

function requestError(action: string, error: unknown): Error {
    const status = (error as {status?: number; statusCode?: number})?.status
        ?? (error as {statusCode?: number})?.statusCode;
    if (status === 401 || status === 403) {
        return new Error(`Unable to ${action}. Sign in to Jellyfin again and check access to this media.`);
    }
    if (status === 404) {
        return new Error(`Unable to ${action}. This item may have moved or been removed; refresh Jellyfin and try again.`);
    }
    return new Error(`Unable to ${action}. Check your connection to Jellyfin and try opening the browser again.`);
}

function imageUrl(item?: BaseItemDto): string | null {
    if (!item?.Id) return null;
    // Landscape artwork suits the TV card; retain a poster/channel logo when that is all the server has.
    const type = item.ImageTags?.Thumb ? 'Thumb' : item.BackdropImageTags?.length ? 'Backdrop'
        : item.ImageTags?.Primary ? 'Primary' : null;
    if (!type) return null;
    return ApiClient.getImageUrl(item.Id, {
        type,
        tag: type === 'Backdrop' ? item.BackdropImageTags[0] : item.ImageTags[type],
        maxWidth: 960,
        quality: 90
    });
}

function movieItem(item: AvailableDto, anchorName: string): TvMediaItem {
    return {
        kind: 'movie', id: item.Id, name: item.Name || 'Untitled film',
        seriesName: anchorName, seasonName: '', seasonNumber: null, episodeNumber: null,
        description: item.Overview || '', imageUrl: imageUrl(item),
        runtimeTicks: Math.max(0, item.RunTimeTicks || 0),
        playbackPositionTicks: Math.max(0, item.UserData?.PlaybackPositionTicks || 0),
        played: item.UserData?.Played === true,
        productionYear: item.ProductionYear ?? undefined,
        genres: item.Genres || [], officialRating: item.OfficialRating || undefined
    };
}

function channelNumber(item: BaseItemDto): string {
    return item.ChannelNumber?.trim() || item.Number?.trim() || '';
}

function channelItem(item: AvailableDto): TvMediaItem {
    const program = item.CurrentProgram;
    return {
        kind: 'channel', id: item.Id, name: item.Name || 'Unnamed channel',
        seriesName: 'Live TV', seasonName: '', seasonNumber: null, episodeNumber: null,
        description: program?.Overview || item.Overview || '',
        imageUrl: imageUrl(program) || imageUrl(item),
        runtimeTicks: Math.max(0, program?.RunTimeTicks || 0),
        playbackPositionTicks: 0, played: false,
        channelNumber: channelNumber(item) || undefined,
        programName: program?.Name || undefined,
        programStart: program?.StartDate || undefined,
        programEnd: program?.EndDate || undefined,
        genres: program?.Genres || item.Genres || [],
        officialRating: program?.OfficialRating || undefined
    };
}

function compareChannels(a: AvailableDto, b: AvailableDto): number {
    const aNumber = channelNumber(a);
    const bNumber = channelNumber(b);
    if (Boolean(aNumber) !== Boolean(bNumber)) return aNumber ? -1 : 1;
    return aNumber.localeCompare(bNumber, undefined, {numeric: true})
        || (a.Name || '').localeCompare(b.Name || '', undefined, {numeric: true})
        || a.Id.localeCompare(b.Id);
}

/** Use the signed-in Jellyfin client for episodes, similar library films, and live channels. */
export class TvMediaSource {
    private readonly episodes = new TvEpisodeSource();

    async load(itemId: string, enabled: (kind: TvMediaKind) => boolean = () => true): Promise<TvMediaList> {
        if (!itemId) throw new Error('No playing item was found. Start an episode, film, or live TV channel and try again.');
        if (typeof ApiClient === 'undefined' || !ApiClient.getCurrentUserId()) {
            throw new Error('Sign in to Jellyfin before opening the media browser.');
        }
        const userId = ApiClient.getCurrentUserId();
        let current: MediaDto;
        try {
            current = await ApiClient.getItem(userId, itemId);
        } catch (error) {
            throw requestError('load the playing item', error);
        }
        if (!current?.Id) throw new Error('Jellyfin did not return the playing item. Refresh Jellyfin and try again.');
        const kind: TvMediaKind | null = current.Type === 'Episode' ? 'episode'
            : current.Type === 'Movie' ? 'movie'
                : current.Type === 'TvChannel' || current.Type === 'Program' ? 'channel' : null;
        if (kind && !enabled(kind)) throw new TvMediaDisabledError();
        if (current.Type === 'Episode') {
            const result = await this.episodes.load(itemId, current);
            return {
                items: result.episodes.map(episode => ({...episode, kind: 'episode'})),
                activeIndex: result.activeIndex, kind: 'episode', playingItemId: current.Id
            };
        }
        if (current.Type === 'Movie') return this.loadMovies(current, userId);
        if (current.Type === 'Program') {
            if (!current.ChannelId) {
                throw new Error('This programme has no live channel. Start a live TV channel and try again.');
            }
            try {
                current = await ApiClient.getItem(userId, current.ChannelId);
            } catch (error) {
                throw requestError('load the playing live TV channel', error);
            }
            if (current?.Type !== 'TvChannel') {
                throw new Error('The programme’s live TV channel is unavailable. Refresh your channels and try again.');
            }
        }
        if (current.Type === 'TvChannel') return this.loadChannels(current, userId);
        throw new Error('Browsing is available while playing a TV episode, film, or live TV channel.');
    }

    private async loadMovies(current: MediaDto, userId: string): Promise<TvMediaList> {
        if (!available(current, 'Movie')) {
            throw new Error('This film is unavailable in your library. Refresh the library and play an available film.');
        }
        let result;
        try {
            // Similar items are ranked by Jellyfin; this endpoint accepts a limit, but not pagination.
            result = await ApiClient.getSimilarItems(current.Id, {
                UserId: userId, Limit: SIMILAR_LIMIT, Fields: 'Overview,Genres'
            });
        } catch (error) {
            throw requestError('load similar films', error);
        }
        if (!Array.isArray(result?.Items)) {
            throw new Error('Jellyfin returned an invalid similar-film list. Refresh your library and try again.');
        }
        const anchorName = current.Name || 'Untitled film';
        const items = [movieItem(current, anchorName)];
        const seen = new Set([current.Id]);
        for (const item of result.Items) {
            if (available(item, 'Movie') && !seen.has(item.Id)) {
                seen.add(item.Id);
                items.push(movieItem(item, anchorName));
                if (items.length > SIMILAR_LIMIT) break;
            }
        }
        return {items, activeIndex: 0, kind: 'movie', playingItemId: current.Id};
    }

    private async loadChannels(current: MediaDto, userId: string): Promise<TvMediaList> {
        if (!available(current, 'TvChannel')) {
            throw new Error('This live TV channel is unavailable. Refresh your channels and try again.');
        }
        const channels = await this.channelPages(userId);
        const unique = new Map<string, AvailableDto>();
        for (const channel of channels) {
            if (available(channel, 'TvChannel') && !unique.has(channel.Id)) unique.set(channel.Id, channel);
        }
        // getItem confirmed the playing channel. Keep it when a changing list or tuner omits it.
        if (!unique.has(current.Id)) unique.set(current.Id, current);
        const items = Array.from(unique.values()).sort(compareChannels).map(channelItem);
        return {
            items, activeIndex: items.findIndex(channel => channel.id === current.Id),
            kind: 'channel', playingItemId: current.Id
        };
    }

    private async channelPages(userId: string): Promise<MediaDto[]> {
        const channels: MediaDto[] = [];
        const seen = new Set<string>();
        let startIndex = 0;
        for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
            let result;
            try {
                result = await ApiClient.getLiveTvChannels({
                    UserId: userId, AddCurrentProgram: true, Fields: 'Overview,Genres',
                    EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop', EnableUserData: true,
                    SortBy: 'ChannelNumber,SortName', SortOrder: 'Ascending', EnableFavoriteSorting: false,
                    StartIndex: startIndex, Limit: CHANNEL_PAGE_SIZE
                });
            } catch (error) {
                throw requestError('load live TV channels', error);
            }
            if (!Array.isArray(result?.Items)) {
                throw new Error('Jellyfin returned an invalid channel list. Refresh your channels and try again.');
            }
            const batch: MediaDto[] = result.Items;
            const total = Number.isInteger(result.TotalRecordCount) && result.TotalRecordCount >= 0
                ? result.TotalRecordCount : null;
            if (batch.length === 0) {
                if (total !== null && startIndex < total) {
                    throw new Error('Jellyfin returned an incomplete channel list. Refresh your channels and try again.');
                }
                return channels;
            }
            const previousSize = seen.size;
            for (const channel of batch) if (channel.Id) seen.add(channel.Id);
            if (seen.size === previousSize) {
                throw new Error('Jellyfin repeated a channel page. Refresh your channels and try again.');
            }
            channels.push(...batch);
            startIndex += batch.length;
            if (total !== null ? startIndex >= total : batch.length < CHANNEL_PAGE_SIZE) return channels;
        }
        throw new Error('The channel list exceeded the browsing limit. Check for duplicate channels and try again.');
    }
}
