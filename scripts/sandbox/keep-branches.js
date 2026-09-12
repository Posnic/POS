/*
 * Put each branch's ordering configuration back after a reset.
 *
 * Run by reset.sh through mongosh, against the sandbox database, once the
 * restore has finished. reset.sh has already put the pre-reset branches into
 * `kept_branches`; this copies the one field out of them that a person typed
 * and would hate to type again - the UPI payee, the store address, which
 * ways of paying are on - and then clears up after itself.
 *
 * A whole file rather than a string built in the shell, because the version
 * that generated this as JavaScript from inside a shell script lost every
 * backslash on the way and wrote a program that could not parse. Code that
 * writes code through two layers of quoting is code nobody can read.
 */
const kept = db.kept_branches;

if (!kept || kept.countDocuments() === 0) {
  print('keep-branches: nothing kept');
} else {
  let put = 0;
  let missed = 0;

  kept.find({}, { online_ordering: 1 }).forEach((row) => {
    if (!row.online_ordering) return;
    /*
     * Matched by id. A reset that RESTORED a snapshot keeps the same ids, so
     * this lands; one that reseeded from scratch built new branches, so it
     * does not, and that is expected rather than a failure - there is no
     * honest way to map an old configuration onto a shop that did not exist
     * when it was written.
     */
    const answer = db.branches.updateOne(
      { _id: row._id },
      { $set: { online_ordering: row.online_ordering } }
    );
    if (answer.matchedCount) put += 1;
    else missed += 1;
  });

  print('keep-branches: put back ' + put + ', no longer present ' + missed);
}

/* The working copy is not part of the sandbox's data and must not be left
   lying in it, where the next dump would carry it into the seed. */
db.kept_branches.drop();
