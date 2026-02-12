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

Clause = _ clause:(WhereClause / SinceClause / OrderByClause / LimitClause) { return clause; }

WhereClause = "where"i _ conditions:ConditionList {
  return { where: conditions };
}

ConditionList = first:Condition rest:(_ "and"i _ c:Condition { return c; })* {
  return [first, ...rest];
}

Condition
  = field:Identifier _ op:Operator _ value:Value {
    return { field, op, value };
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

Value = QuotedString / Number / Identifier
QuotedString = "'" chars:$[^']* "'" { return chars; }
Number = digits:$[0-9]+ { return parseInt(digits, 10); }
Resource = $([a-zA-Z_][a-zA-Z0-9_/]*)
Identifier = $([a-zA-Z_][a-zA-Z0-9_]*)
Integer = digits:$[0-9]+ { return parseInt(digits, 10); }
_ = [ \t\n\r]*
