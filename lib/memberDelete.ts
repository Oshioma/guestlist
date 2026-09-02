// REMOVING SOMEBODY.
//
// The schema already knows the difference between a person and what they left
// behind: of the ninety-odd foreign keys pointing at members, the personal
// ones cascade (sessions, RSVPs, messages, follows) and the rest set null
// (an event they submitted, an article byline, an audit entry). So a delete is
// one statement, and the database does the sorting.
//
// The guards are the part worth writing down:
//
//   - An admin cannot delete themselves. Locking yourself out of your own
//     platform should take more than a mis-click.
//   - An admin cannot delete another admin. Demote first, then delete: two
//     deliberate acts rather than one, for the account type that can undo
//     everything else.
//   - The audit entry is written BEFORE the row goes, because afterwards
//     there is nothing left to describe.
//
// This is a real delete, not a flag. Somebody who asks to be gone should be
// gone, and a spam account nobody wants should not sit in the table forever
// wearing a tombstone.

import { query, queryOne } from './db';
import { audit } from './audit';

export type DeletableMember = {
  id: string;
  display_name: string;
  email: string;
  role: string;
  slug: string | null;
};

export class MemberDeleteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function deleteMember(memberId: string, actorId: string): Promise<DeletableMember> {
  const member = await queryOne<DeletableMember>(
    `select id, display_name, email, role, slug from members where id = $1`,
    [memberId]
  );
  if (!member) throw new MemberDeleteError('That member no longer exists', 404);
  if (member.id === actorId) {
    throw new MemberDeleteError('You cannot delete your own account from here', 400);
  }
  if (member.role === 'admin') {
    throw new MemberDeleteError('Change this person out of the admin role before deleting them', 400);
  }

  // Written first: once the row is gone there is nothing left to describe,
  // and "who deleted whom" is exactly the thing you want on the record.
  await audit('member_deleted', {
    actorId,
    detail: {
      memberId: member.id,
      name: member.display_name,
      email: member.email,
      slug: member.slug,
    },
  });

  await query(`delete from members where id = $1`, [memberId]);
  return member;
}
