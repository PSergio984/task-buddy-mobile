/**
 * Smart Import draft logic (#3): proposal → draft mapping, the
 * include/exclude/validity gate (committable), and the TaskCreateData
 * payload the commit loop posts per card.
 */
import type { ImportTaskProposal } from '@/api/types';
import {
  committable,
  deadlineError,
  planJobs,
  toDrafts,
  toTaskCreate,
  type DraftProposal,
} from '@/components/import/draft';

function proposal(over: Partial<ImportTaskProposal> = {}): ImportTaskProposal {
  return {
    title: 'Buy milk',
    description: null,
    proposed_deadline: null,
    priority: 'MEDIUM',
    suggested_project_id: null,
    subtasks: [],
    ...over,
  };
}

function draft(over: Partial<DraftProposal> = {}): DraftProposal {
  return { ...toDrafts([proposal()])[0], ...over };
}

describe('toDrafts', () => {
  it('maps proposals to included, uncreated drafts', () => {
    const drafts = toDrafts([
      proposal({
        title: 'Plan trip',
        description: 'Flights + hotel',
        proposed_deadline: '2026-03-15T17:00:00Z',
        priority: 'HIGH',
        suggested_project_id: 7,
        subtasks: [{ title: 'Book flights' }, { title: 'Reserve hotel' }],
      }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      included: true,
      created: false,
      idempotencyKey: null,
      title: 'Plan trip',
      deadline: '2026-03-15', // ISO sliced to editable YYYY-MM-DD
      priority: 'HIGH',
      projectId: 7,
      subtasks: ['Book flights', 'Reserve hotel'],
    });
  });

  it('defaults a null deadline to the empty string', () => {
    expect(toDrafts([proposal()])[0].deadline).toBe('');
  });
});

describe('deadlineError', () => {
  it('accepts empty and valid YYYY-MM-DD values', () => {
    expect(deadlineError('')).toBeNull();
    expect(deadlineError('2026-03-15')).toBeNull();
  });

  it('rejects malformed and nonexistent dates', () => {
    expect(deadlineError('15/03/2026')).not.toBeNull();
    expect(deadlineError('2026-13-01')).not.toBeNull();
    // Date.parse normalizes Feb 31 into March — the round-trip check
    // must catch what the parser accepts.
    expect(deadlineError('2026-02-31')).not.toBeNull();
    expect(deadlineError('2026-02-30')).not.toBeNull();
  });
});

describe('committable', () => {
  it('includes drafts by default', () => {
    expect(committable(toDrafts([proposal(), proposal()]))).toHaveLength(2);
  });

  it('drops excluded, created, empty-title, and bad-deadline drafts', () => {
    const drafts = [
      draft({ id: 0, included: false }),
      draft({ id: 1, created: true }),
      draft({ id: 2, title: '   ' }),
      draft({ id: 3, deadline: 'tomorrow' }),
      draft({ id: 4 }),
    ];
    expect(committable(drafts).map((d) => d.id)).toEqual([4]);
  });
});

describe('toTaskCreate', () => {
  it('builds a full TaskCreateData payload', () => {
    const payload = toTaskCreate(
      draft({
        title: '  Plan trip  ',
        description: 'Flights + hotel',
        deadline: '2026-03-15',
        priority: 'HIGH',
        projectId: 7,
        subtasks: ['Book flights'],
      }),
    );
    expect(payload).toEqual({
      title: 'Plan trip',
      description: 'Flights + hotel',
      // Noon UTC keeps the calendar date for offsets UTC-11..UTC+11 —
      // midnight reads as the previous day west of UTC.
      due_date: '2026-03-15T12:00:00Z',
      priority: 'HIGH',
      project_id: 7,
      subtasks: [{ title: 'Book flights' }],
    });
  });

  it('omits absent optional fields', () => {
    const payload = toTaskCreate(draft({ title: 'Bare', description: '  ' }));
    expect(payload).toEqual({ title: 'Bare', priority: 'MEDIUM' });
    expect(payload).not.toHaveProperty('due_date');
    expect(payload).not.toHaveProperty('project_id');
    expect(payload).not.toHaveProperty('subtasks');
    expect(payload).not.toHaveProperty('description');
  });

  it('clips read-only fields to the backend length limits', () => {
    const payload = toTaskCreate(
      draft({ description: ` ${'d'.repeat(2100)} `, subtasks: ['s'.repeat(100)] }),
    );
    expect(payload.description).toBe('d'.repeat(2000));
    expect(payload.subtasks).toEqual([{ title: 's'.repeat(80) }]);
  });

  it('clips on code points so an emoji at the boundary is not split', () => {
    const payload = toTaskCreate(draft({ title: '🚀'.repeat(120) }));
    expect(payload.title).toBe('🚀'.repeat(100));
  });

  it('clips an over-limit proposal title at intake and at payload build', () => {
    const long = 't'.repeat(150);
    const d = toDrafts([proposal({ title: long })])[0];
    expect(d.title).toBe('t'.repeat(100));
    expect(toTaskCreate(d).title).toBe('t'.repeat(100));
  });
});

describe('planJobs', () => {
  let minted = 0;
  const uuid = () => `key-${++minted}`;

  beforeEach(() => {
    minted = 0;
  });

  it('mints one key per committable draft', () => {
    const jobs = planJobs(toDrafts([proposal(), proposal()]), uuid);
    expect(jobs.map((j) => j.key)).toEqual(['key-1', 'key-2']);
    expect(jobs.map((j) => j.id)).toEqual([0, 1]);
    expect(jobs[0].payload).toEqual(toTaskCreate(draft({ id: 0 })));
  });

  it('reuses the stored idempotencyKey on retry instead of re-minting', () => {
    const first = planJobs(toDrafts([proposal()]), uuid);
    expect(first[0].key).toBe('key-1');
    // The screen stamps the key on the draft before posting — a retry
    // must reuse it so the backend replays, not double-creates.
    const retry = planJobs([draft({ idempotencyKey: first[0].key })], uuid);
    expect(retry[0].key).toBe('key-1');
    expect(minted).toBe(1);
  });

  it('skips created, excluded, and invalid drafts', () => {
    const jobs = planJobs(
      [
        draft({ id: 0, created: true }),
        draft({ id: 1, included: false }),
        draft({ id: 2, title: '   ' }),
        draft({ id: 3, deadline: 'tomorrow' }),
        draft({ id: 4 }),
      ],
      uuid,
    );
    expect(jobs.map((j) => j.id)).toEqual([4]);
    expect(minted).toBe(1); // one mint, only for the committable draft
  });
});
