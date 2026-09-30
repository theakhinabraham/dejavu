# Conversational planning interpreter

`app.nlu` is a small rule based layer in front of the existing comparison API. The React chat sends each first turn to `POST /api/chat/interpret`; the interpreter activates for gym/fitness plus work/assignment decisions and stays active for that browser session. General decisions continue through the current chat path.

The response carries normalized slot values, per-value confidence and source text, unresolved fields, corrections, and the next assistant prompt. Values live in process memory for up to twelve hours (and are evicted when the bounded cache fills); they are not written to the database. The parser asks for missing details one at a time, checks low-confidence values, summarizes the interpretation, and waits for confirmation before handing the user back to the current comparison flow. The existing simulator contract is unchanged.

Examples covered by the parser:

| User wording | Interpretation |
| --- | --- |
| “I’ve got a week off and I’m torn between gym and assignments” | 7 days, a gym vs. assignment decision, then a question for the first missing detail |
| “Maybe a couple weeks” | 14 days with reduced confidence; asks the user to confirm |
| “I usually do okay but not always” | Follow-through score 4/5 (“usually”) |
| “An hour and a half a day” | 1.5 available hours per day when that slot is being clarified |
| “I want to get in shape but I’m behind on work” | Gym goal and assignment load retained as separate values |
| “I said 2 hours a day but maybe 5 hours a day” | Uses the later 5-hour value and records the correction |

The parser does not invent missing values. Confidence and source text remain attached to every extracted slot so future model based extraction can replace or augment these rules without changing the simulation API.
