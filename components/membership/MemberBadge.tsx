// GUESTLIST MEMBER — a mark of belonging to a cultural community. Deliberately
// just the words: public identity (member since, been there, going) is a
// later, deliberate design.

export function MemberBadge({ style }: { style?: React.CSSProperties }) {
  return <span className="memberBadge" style={style} title="Guestlist member">Guestlist member</span>;
}
