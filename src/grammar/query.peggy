// Blink Query DSL
// Examples:
//   discoveries where tag='auth' order by hit_count desc limit 5
//   sessions since '2026-02-01'
//   files where contains='authentication' limit 5
{
  function merge(resource, clauses) {
    return Object.assign({ resource }, ...clauses);
  }
}

Query = _ resource:Resource clauses:Clause* _ {
  return merge(resource, clauses);
}

Clause = _ clause:(WhereClause / SinceClause / OrderByClause / LimitClause / OffsetClause) { return clause; }

WhereClause = "where"i _ expr:OrExpr {
  return { where: expr };
}

// OR has lower precedence than AND
OrExpr = first:AndExpr rest:(_ "or"i _ e:AndExpr { return e; })* {
  if (rest.length === 0) return first;
  return { type: 'or', children: [first, ...rest] };
}

// AND has higher precedence than OR
AndExpr = first:Atom rest:(_ "and"i _ a:Atom { return a; })* {
  if (rest.length === 0) return first;
  return { type: 'and', children: [first, ...rest] };
}

// Atom: either a parenthesized expression or a condition
Atom = "(" _ expr:OrExpr _ ")" { return expr; } / Condition

Condition
  = field:Identifier _ "in"i _ "(" _ values:ValueList _ ")" {
    return { field, op: 'in', value: values };
  }
  / field:Identifier _ op:Operator _ value:Value {
    return { field, op, value };
  }

ValueList = first:Value rest:(_ "," _ v:Value { return v; })* {
  return [first, ...rest];
}

Operator
  = "contains" { return "contains"; }
  / "!=" { return "!="; }
  / ">=" { return ">="; }
  / "<=" { return "<="; }
  / ">"  { return ">"; }
  / "<"  { return "<"; }
  / "="  { return "="; }

SinceClause = "since"i _ date:QuotedString {
  return { since: date };
}

OrderByClause = "order"i _ "by"i _ field:Identifier _ dir:Direction? {
  return { orderBy: { field, direction: dir || "asc" } };
}

Direction = "asc"i { return "asc"; } / "desc"i { return "desc"; }

LimitClause = "limit"i _ n:Integer { return { limit: n }; }

OffsetClause = "offset"i _ n:Integer { return { offset: n }; }

Value = QuotedString / Number / Identifier
QuotedString = "'" chars:$[^']* "'" { return chars; }
Number = digits:$[0-9]+ { return parseInt(digits, 10); }
Resource = $([a-zA-Z_][a-zA-Z0-9_/]*)
Identifier = $([a-zA-Z_][a-zA-Z0-9_]*)
Integer = digits:$[0-9]+ { return parseInt(digits, 10); }
_ = [ \t\n\r]*
