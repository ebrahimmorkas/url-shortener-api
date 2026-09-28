import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { links, type Link } from '../../db/schema.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import { generateCode, isReservedAlias } from './codes.js';

const MAX_CODE_ATTEMPTS = 5;

export interface CreateLinkInput {
  targetUrl: string;
  alias?: string;
  title?: string;
  expiresAt?: Date;
  maxClicks?: number;
}

export type UpdateLinkInput = Partial<
  Pick<CreateLinkInput, 'targetUrl' | 'title' | 'expiresAt' | 'maxClicks'>
> & { isActive?: boolean };

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string }).code === '23505' ||
  (err as { cause?: { code?: string } }).cause?.code === '23505';

export function serializeLink(link: Link, baseUrl: string) {
  return {
    id: link.id,
    code: link.code,
    shortUrl: `${baseUrl.replace(/\/$/, '')}/${link.code}`,
    targetUrl: link.targetUrl,
    title: link.title,
    expiresAt: link.expiresAt,
    maxClicks: link.maxClicks,
    clickCount: link.clickCount,
    isActive: link.isActive,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

/** Rejects non-http(s) targets and links that point back at the shortener (redirect loops). */
export function assertSafeTarget(targetUrl: string, baseUrl: string) {
  const target = new URL(targetUrl);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw BadRequest('Only http and https URLs can be shortened');
  }
  if (target.host.toLowerCase() === new URL(baseUrl).host.toLowerCase()) {
    throw BadRequest('Links to the shortener itself are not allowed');
  }
}

const encodeCursor = (link: Pick<Link, 'createdAt' | 'id'>) =>
  Buffer.from(`${link.createdAt.toISOString()}|${link.id}`).toString('base64url');

function decodeCursor(cursor: string) {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw BadRequest('Invalid cursor');
  return { createdAt, id };
}

export class LinksService {
  constructor(
    private readonly db: Database,
    private readonly baseUrl: string,
  ) {}

  async create(userId: string, input: CreateLinkInput): Promise<Link> {
    assertSafeTarget(input.targetUrl, this.baseUrl);
    if (input.alias && isReservedAlias(input.alias)) {
      throw Conflict(`"${input.alias}" is reserved`, 'ALIAS_RESERVED');
    }

    const values = {
      userId,
      targetUrl: input.targetUrl,
      title: input.title ?? null,
      expiresAt: input.expiresAt ?? null,
      maxClicks: input.maxClicks ?? null,
    };

    if (input.alias) {
      try {
        const [link] = await this.db
          .insert(links)
          .values({ ...values, code: input.alias })
          .returning();
        return link!;
      } catch (err) {
        if (isUniqueViolation(err)) throw Conflict('This alias is already taken', 'ALIAS_TAKEN');
        throw err;
      }
    }

    // Random codes: retry on the (astronomically rare) collision, enforced by the unique index.
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      try {
        const [link] = await this.db
          .insert(links)
          .values({ ...values, code: generateCode() })
          .returning();
        return link!;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === MAX_CODE_ATTEMPTS) throw err;
      }
    }
    throw new Error('unreachable');
  }

  async getOwned(userId: string, id: string): Promise<Link> {
    const link = await this.db.query.links.findFirst({
      where: and(eq(links.id, id), eq(links.userId, userId)),
    });
    if (!link) throw NotFound('Link');
    return link;
  }

  async list(userId: string, opts: { limit: number; cursor?: string; search?: string }) {
    const conditions: SQL[] = [eq(links.userId, userId)];
    if (opts.search) {
      const pattern = `%${opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        or(
          ilike(links.title, pattern),
          ilike(links.targetUrl, pattern),
          ilike(links.code, pattern),
        )!,
      );
    }
    if (opts.cursor) {
      const { createdAt, id } = decodeCursor(opts.cursor);
      conditions.push(
        or(lt(links.createdAt, createdAt), and(eq(links.createdAt, createdAt), lt(links.id, id)))!,
      );
    }

    const rows = await this.db
      .select()
      .from(links)
      .where(and(...conditions))
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(opts.limit + 1);

    const page = rows.slice(0, opts.limit);
    return {
      data: page,
      nextCursor: rows.length > opts.limit ? encodeCursor(page.at(-1)!) : null,
    };
  }

  async update(userId: string, id: string, input: UpdateLinkInput): Promise<Link> {
    await this.getOwned(userId, id);
    if (input.targetUrl) assertSafeTarget(input.targetUrl, this.baseUrl);
    const [link] = await this.db
      .update(links)
      .set({ ...input, updatedAt: sql`now()` })
      .where(and(eq(links.id, id), eq(links.userId, userId)))
      .returning();
    return link!;
  }

  async delete(userId: string, id: string): Promise<Link> {
    const [link] = await this.db
      .delete(links)
      .where(and(eq(links.id, id), eq(links.userId, userId)))
      .returning();
    if (!link) throw NotFound('Link');
    return link;
  }
}
