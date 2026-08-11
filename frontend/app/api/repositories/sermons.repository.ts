import { randomUUID } from 'crypto';

import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { Sermon, SermonOutline, SermonContent, SermonPoint, PreachDate } from '@/models/models';
import { toDateOnlyKey } from '@/utils/dateOnly';

/**
 * REPLAY MEMORY FOR PREACH-DATE WRITES.
 *
 * The Firestore SDK can run a transaction callback again even after the commit
 * already landed — the acknowledgement is what got lost, not the write. So each
 * logical operation carries an id, the sermon remembers the recent ones, and a
 * replay recognises itself instead of applying its work twice: re-adding an entry
 * deleted meanwhile, re-deleting one re-created meanwhile, or laying an old patch
 * over a newer edit.
 *
 * The memory is a SHORT RING inside the sermon document, deliberately not a marker
 * document per write: a marker collection grows without bound, outlives the sermon
 * it belongs to (Firestore keeps orphaned subcollections after the parent is
 * deleted), and doubles the cost of every date edit — a permanent price for a
 * window measured in milliseconds. Twenty is well past the largest real burst,
 * which is the dashboard updating several dates at once
 * (`components/dashboard/OptionMenu.tsx`).
 */
const PREACH_DATE_OPS_REMEMBERED = 20;

type PreachDateDoc = Sermon & { preachDateOps?: string[] };

const readPreachDateState = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
  const data = (snapshot.data() || {}) as PreachDateDoc;
  return { preachDates: data.preachDates || [], appliedOps: data.preachDateOps || [] };
};

const rememberOperation = (appliedOps: string[], operationId: string): string[] =>
  [...appliedOps, operationId].slice(-PREACH_DATE_OPS_REMEMBERED);

// Error message constants
const ERROR_MESSAGES = {
  SERMON_NOT_FOUND: "Sermon not found",
} as const;

/**
 * Repository for user settings database operations
 */
export class SermonsRepository {
  private readonly collection = "sermons";

  async fetchSermonById(id: string) {
    console.log(`Firestore: fetching sermon ${id}`);
    try {
      // Use the Admin SDK to fetch the sermon
      const docRef = adminDb.collection("sermons").doc(id);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${id} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }
      const rawData = docSnap.data() as Sermon;
      const normalized: Sermon = {
        ...rawData,
        id: docSnap.id,
      };

      const hydratedStructure = rawData.thoughtsBySection || rawData.structure;
      if (hydratedStructure) {
        normalized.thoughtsBySection = hydratedStructure;
        normalized.structure = rawData.structure || hydratedStructure;
      }

      const hydratedDraft = rawData.draft || rawData.plan;
      if (hydratedDraft) {
        normalized.draft = hydratedDraft;
        normalized.plan = rawData.plan || hydratedDraft;
      }

      console.log(`Sermon retrieved: with id ${normalized.id} and title ${normalized.title}`);
      return normalized;
    } catch (error) {
      console.error(`Error fetching sermon with id ${id}:`, error);
      throw error;
    }
  }

  /**
   * @param aggregate which editable aggregate this write touches. Server writes go
   * around the client guard, so if they change data WITHOUT advancing the counter
   * it starts to lie: a later client save built from an older text then looks up to
   * date and is granted permission to overwrite what the server just stored.
   * Passing the aggregate keeps the counter truthful across both sides.
   */
  async updateSermonData(
    id: string,
    updateData: Record<string, unknown>,
    aggregate?: string
  ): Promise<void> {
    console.log(`Firestore: updating sermon data ${id}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(id);

      // Inject the server timestamp for updatedAt
      const dataWithTimestamp = {
        ...updateData,
        ...(aggregate ? { [`rev.${aggregate}`]: FieldValue.increment(1) } : {}),
        updatedAt: new Date().toISOString()
      };

      await docRef.update(dataWithTimestamp);
      console.log(`Firestore: updated sermon data ${id} successfully`);
    } catch (error) {
      console.error(`Error updating sermon data for ${id}:`, error);
      throw error;
    }
  }

  async deleteSermonById(id: string): Promise<void> {
    console.log(`Firestore: deleting sermon ${id}`);
    try {
      // Use the Admin SDK to delete the sermon
      const docRef = adminDb.collection("sermons").doc(id);
      await docRef.delete();
      console.log(`Firestore: deleted sermon ${id}`);
    } catch (error) {
      console.error(`Error deleting sermon with id ${id}:`, error);
      throw error;
    }
  }

  async fetchSermonOutlineBySermonId(sermonId: string) {
    console.log(`Fetching sermon outline for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      const sermon = docSnap.data() as Sermon;
      console.log(`Sermon outline retrieved for sermon id ${sermonId}`);
      return sermon.outline || {};
    } catch (error) {
      console.error(`Error fetching sermon outline with id ${sermonId}:`, error);
      throw error;
    }
  }

  async updateSermonOutline(sermonId: string, outline: SermonOutline): Promise<SermonOutline> {
    console.log(`Updating sermon outline for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      // Update the outline field in the sermon document
      // The counter must move for EVERY writer of an aggregate: a writer that
      // changes data and leaves the number alone makes it lie, and the next stale
      // save is then handed permission to overwrite.
      await this.updateSermonData(sermonId, { outline }, 'outline');
      console.log(`Sermon outline updated for sermon id ${sermonId}`);

      return outline;
    } catch (error) {
      console.error(`Error updating sermon outline for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async updateSermonContent(sermonId: string, content: SermonContent): Promise<SermonContent> {
    console.log(`Updating sermon content for sermon ${sermonId}`);
    console.log(`Content data to update:`, JSON.stringify(content, null, 2));

    // Validate content structure before updating
    if (!content || typeof content !== 'object') {
      console.error('ERROR: Invalid content data - content is not an object');
      throw new Error('Invalid content data');
    }

    if (!content.introduction || !content.main || !content.conclusion) {
      console.error('ERROR: Invalid content structure - missing required sections');
      throw new Error('Invalid content structure');
    }

    if (typeof content.introduction.outline !== 'string' ||
      typeof content.main.outline !== 'string' ||
      typeof content.conclusion.outline !== 'string') {
      console.error('ERROR: Invalid content structure - outline values must be strings');
      throw new Error('Invalid content structure - outline values must be strings');
    }

    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      // Update both the draft field and legacy plan for backward compatibility
      // Note: We keep "draft" as the field name in DB but refer to it as "content" in code
      await this.updateSermonData(sermonId, { draft: content, plan: content }, 'plan');
      console.log(`Sermon content updated for sermon id ${sermonId}`);

      return content;
    } catch (error) {
      console.error(`Error updating sermon content for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  /**
   * Write ONLY the plan sections the caller states — each by its own nested path.
   *
   * WHY THIS EXISTS. The plan editor saves one point of one section, but the save
   * used to travel as a whole `SermonContent`: the two sections it never touched went
   * along as this laptop's hours-old copy and replaced an introduction rewritten on
   * the phone that morning, silently. Firestore merges a nested path into the stored
   * map, so a section nobody mentioned is not written at all — two devices working on
   * DIFFERENT sections stop colliding entirely, with no refusal and nothing to decide.
   *
   * `draft` is the stored field and `plan` its legacy alias; both are kept in sync,
   * section by section, exactly as the whole-document writer did.
   */
  async updateSermonContentSections(
    sermonId: string,
    sections: Partial<SermonContent>
  ): Promise<Partial<SermonContent>> {
    const keys = (Object.keys(sections) as (keyof SermonContent)[]).filter(
      (key) => sections[key] !== undefined
    );
    if (!keys.length) throw new Error('Invalid content structure - no sections given');

    const payload: Record<string, unknown> = {};
    keys.forEach((key) => {
      const section = sections[key];
      if (typeof section?.outline !== 'string') {
        throw new Error('Invalid content structure - outline values must be strings');
      }
      payload[`draft.${key}`] = section;
      payload[`plan.${key}`] = section;
    });

    await this.updateSermonData(sermonId, payload, 'plan');
    return sections;
  }

  /** @deprecated Use updateSermonContent instead. Kept for backward compatibility. */
  async updateSermonPlan(sermonId: string, content: SermonContent): Promise<SermonContent> {
    return this.updateSermonContent(sermonId, content);
  }

  /**
   * Fetches adjacent outline points (previous and next) for a given outline point.
   * This is used to provide context for AI generation.
   */
  async fetchAdjacentOutlinePoints(sermonId: string, outlinePointId: string) {
    console.log(`Fetching adjacent outline points for point ${outlinePointId} in sermon ${sermonId}`);
    try {
      const sermon = await this.fetchSermonById(sermonId);
      if (!sermon || !sermon.outline) return null;

      // Helper to find point in a specific section list
      const findInList = (list: SermonPoint[]) => list.findIndex(op => op.id === outlinePointId);

      // Check each section
      let section: 'introduction' | 'main' | 'conclusion' | null = null;
      let index = -1;
      let list: SermonPoint[] = [];

      if ((index = findInList(sermon.outline.introduction)) !== -1) {
        section = 'introduction';
        list = sermon.outline.introduction;
      } else if ((index = findInList(sermon.outline.main)) !== -1) {
        section = 'main';
        list = sermon.outline.main;
      } else if ((index = findInList(sermon.outline.conclusion)) !== -1) {
        section = 'conclusion';
        list = sermon.outline.conclusion;
      }

      if (!section) return null;

      const previousPoint = index > 0 ? list[index - 1] : null;
      const nextPoint = index < list.length - 1 ? list[index + 1] : null;

      // If at boundary of a section, we could technically fetch from adjacent sections,
      // but for now, let's stick to within-section context to keep it simple.

      return {
        previousPoint: previousPoint ? { text: previousPoint.text } : null,
        nextPoint: nextPoint ? { text: nextPoint.text } : null,
        section
      };
    } catch (error) {
      console.error(`Error fetching adjacent points for ${outlinePointId}:`, error);
      return null;
    }
  }

  async updateSermonSeriesInfo(sermonId: string, seriesId: string | null, position: number | null): Promise<void> {
    console.log(`Updating sermon series info for sermon ${sermonId}`);

    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      // Prepare update data
      const updateData: { seriesId?: string | null; seriesPosition?: number | null } = {};

      if (seriesId !== undefined) {
        updateData.seriesId = seriesId;
      }

      if (position !== undefined) {
        updateData.seriesPosition = position;
      }

      if (Object.keys(updateData).length === 0) {
        console.log(`No series info updates needed for sermon ${sermonId}`);
        return;
      }

      // Series linkage/position is index metadata. Do not bump user-facing
      // updatedAt here; bulk series syncs must not make old sermons look edited.
      await docRef.update(updateData);
      console.log(`Sermon series info updated for sermon id ${sermonId}`);
    } catch (error) {
      console.error(`Error updating sermon series info for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async addPreachDate(sermonId: string, preachDate: Omit<PreachDate, 'id' | 'createdAt'> & { id?: string }): Promise<PreachDate> {
    console.log(`Firestore: adding preach date to sermon ${sermonId}`);
    try {
      const normalizedDate = toDateOnlyKey(preachDate.date);
      if (!normalizedDate) {
        throw new Error("Invalid preach date format");
      }

      // Idempotent by client-supplied id: a replayed add (offline retry / the
      // dashboard online-flush double-fire) carrying the same id must not append a
      // duplicate. We read-modify-write instead of arrayUnion, because two replays
      // build objects with different createdAt -> arrayUnion would treat them as
      // distinct and append both. With a client id, the SECOND add is a no-op.
      const clientId = preachDate.id;
      if (clientId) {
        const docRef = adminDb.collection(this.collection).doc(sermonId);
        const operationId = randomUUID();
        const result = await adminDb.runTransaction(async (transaction) => {
          const docSnap = await transaction.get(docRef);
          if (!docSnap.exists) {
            throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
          }

          const { preachDates: existingDates, appliedOps } = readPreachDateState(docSnap);
          if (appliedOps.includes(operationId)) {
            // Our write already landed; the entry may since have been deleted from
            // another device. Re-adding it would resurrect what someone removed.
            const current = existingDates.find(pd => pd.id === clientId);
            if (current) return current;
            return { ...preachDate, id: clientId } as PreachDate;
          }

          const freshNormalizedDate = toDateOnlyKey(preachDate.date);
          if (!freshNormalizedDate) {
            throw new Error("Invalid preach date format");
          }
          const existing = existingDates.find(pd => pd.id === clientId);
          if (existing) {
            return existing;
          }

          const newPreachDate: PreachDate = {
            ...preachDate,
            date: freshNormalizedDate,
            status: preachDate.status || 'planned',
            id: clientId,
            createdAt: new Date().toISOString()
          };
          transaction.update(docRef, {
            preachDates: [...existingDates, newPreachDate],
            preachDateOps: rememberOperation(appliedOps, operationId),
            'rev.preachDates': FieldValue.increment(1),
            updatedAt: new Date().toISOString()
          });
          return newPreachDate;
        });

        console.log(`Firestore: added preach date ${result.id} to sermon ${sermonId}`);
        return result;
      }

      const newPreachDate: PreachDate = {
        ...preachDate,
        date: normalizedDate,
        status: preachDate.status || 'planned',
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      };

      await this.updateSermonData(sermonId, {
        preachDates: FieldValue.arrayUnion(newPreachDate)
      }, 'preachDates');

      console.log(`Firestore: added preach date ${newPreachDate.id} to sermon ${sermonId}`);
      return newPreachDate;
    } catch (error) {
      console.error(`Error adding preach date to sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async updatePreachDate(sermonId: string, dateId: string, updates: Partial<PreachDate>): Promise<PreachDate> {
    console.log(`Firestore: updating preach date ${dateId} for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(sermonId);
      // Of the three, this is the one a replay can actively corrupt: it merges a
      // PARTIAL patch onto whatever it reads, so replaying would lay the old patch
      // over a newer edit of the same date. See `PREACH_DATE_OPS_REMEMBERED`.
      const operationId = randomUUID();
      const updatedPreachDate = await adminDb.runTransaction(async (transaction) => {
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists) {
          throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
        }

        const { preachDates, appliedOps } = readPreachDateState(docSnap);

        if (appliedOps.includes(operationId)) {
          // This write already landed. Report what is stored NOW — a newer edit made
          // in between is the truth, and echoing our own copy would hide it.
          const current = preachDates.find(pd => pd.id === dateId);
          if (!current) {
            throw new Error("Preach date not found");
          }
          return current;
        }

        const index = preachDates.findIndex(pd => pd.id === dateId);
        if (index === -1) {
          throw new Error("Preach date not found");
        }

        const normalizedDate = updates.date === undefined ? undefined : toDateOnlyKey(updates.date);
        if (updates.date !== undefined && !normalizedDate) {
          throw new Error("Invalid preach date format");
        }

        const result: PreachDate = {
          ...preachDates[index],
          ...updates,
          ...(normalizedDate ? { date: normalizedDate } : {}),
          id: preachDates[index].id,
          createdAt: preachDates[index].createdAt
        };
        const updatedArray = [...preachDates];
        updatedArray[index] = result;

        transaction.update(docRef, {
          preachDates: updatedArray,
          preachDateOps: rememberOperation(appliedOps, operationId),
          'rev.preachDates': FieldValue.increment(1),
          updatedAt: new Date().toISOString()
        });
        return result;
      });

      console.log(`Firestore: updated preach date ${dateId} for sermon ${sermonId}`);
      return updatedPreachDate;
    } catch (error) {
      console.error(`Error updating preach date ${dateId} for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async deletePreachDate(sermonId: string, dateId: string): Promise<void> {
    console.log(`Firestore: deleting preach date ${dateId} from sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(sermonId);
      // Removing an id that is already gone lands on the same array, so a replay is
      // harmless — EXCEPT when the same id was re-created meanwhile, which a replay
      // would delete again. See `PREACH_DATE_OPS_REMEMBERED`.
      const operationId = randomUUID();
      await adminDb.runTransaction(async (transaction) => {
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists) {
          throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
        }

        const { preachDates, appliedOps } = readPreachDateState(docSnap);
        if (appliedOps.includes(operationId)) return;

        const updatedArray = preachDates.filter(pd => pd.id !== dateId);
        transaction.update(docRef, {
          preachDates: updatedArray,
          preachDateOps: rememberOperation(appliedOps, operationId),
          'rev.preachDates': FieldValue.increment(1),
          updatedAt: new Date().toISOString()
        });
      });

      console.log(`Firestore: deleted preach date ${dateId} from sermon ${sermonId}`);
    } catch (error) {
      console.error(`Error deleting preach date ${dateId} from sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async fetchSermonsWithPreachDates(userId: string, startDate?: string, endDate?: string): Promise<Sermon[]> {
    console.log(`Firestore: fetching sermons with preach dates for user ${userId}`);
    try {
      const query = adminDb.collection(this.collection).where("userId", "==", userId);

      const snapshot = await query.get();
      let sermons: Sermon[] = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Sermon[];

      // Hydrate structure and draft for all fetched sermons
      sermons = sermons.map(s => {
        const hydrated: Sermon = { ...s };
        const hydratedStructure = s.thoughtsBySection || s.structure;
        if (hydratedStructure) {
          hydrated.thoughtsBySection = hydratedStructure;
          hydrated.structure = s.structure || hydratedStructure;
        }
        const hydratedDraft = s.draft || s.plan;
        if (hydratedDraft) {
          hydrated.draft = hydratedDraft;
          hydrated.plan = s.plan || hydratedDraft;
        }
        return hydrated;
      });

      // Simple filtering in memory for now because Firestore array filtering is limited
      // and we expect small number of sermons per user
      if (startDate || endDate) {
        const normalizedStartDate = toDateOnlyKey(startDate);
        const normalizedEndDate = toDateOnlyKey(endDate);
        sermons = sermons.filter(s => {
          if (!s.preachDates?.length) return false;
          return s.preachDates.some(pd => {
            const date = toDateOnlyKey(pd.date);
            if (!date) return false;
            if (normalizedStartDate && date < normalizedStartDate) return false;
            if (normalizedEndDate && date > normalizedEndDate) return false;
            return true;
          });
        });
      }

      console.log(`Firestore: fetched ${sermons.length} sermons for user ${userId}`);
      return sermons;
    } catch (error) {
      console.error(`Error fetching sermons for user ${userId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const sermonsRepository = new SermonsRepository(); 
