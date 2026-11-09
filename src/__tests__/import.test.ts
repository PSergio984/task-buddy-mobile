/**
 * Smart Import draft logic (#3): proposal → draft mapping, the
 * include/exclude/validity gate (committable), and the TaskCreateData
 * payload the commit loop posts per card.
 */
import type { ImportTaskProposal } from '@/api/types';
import {
  committable,
  deadlineError,
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
      due_date: '2026-03-15T00:00:00Z',
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
});
