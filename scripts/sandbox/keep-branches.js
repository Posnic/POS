/*
 * Put back what a person configured, after a reset.
 *
 * Run by reset.sh through mongosh once the restore has finished. reset.sh
 * has already put the pre-reset branches into `kept_branches` and restored
 * the two settings collections; this decides where all of it now belongs.
 *
 * TWO CASES, and the second is the one that matters.
 *
 * A RESTORE brings the same branch ids back, so everything simply lands: the
 * configuration is copied onto the branch it came from and the settings rows
 * already point at it.
 *
 * A REBUILD mints new ids. The restored settings rows then point at a branch
 * that no longer exists, and the shop reads as though nothing was ever
 * configured - no key, no switches, no store address. That is what happened
 * to the sandbox: the keep saved everything faithfully and none of it was in
 * force. So when the old branch is gone and there is exactly ONE shop now,
 * the configuration and the settings rows are re-homed onto it. One shop is
 * not a guess; several would be, and then this does nothing and says so.
 */
const kept = db.kept_branches;

function only(collection) {
  return collection.countDocuments() === 1 ? collection.findOne({}) : null;
}

if (!kept || kept.countDocuments() === 0) {
  print('keep-branches: nothing kept');
} else {
  const shopNow = only(db.branches);
  let put = 0;
  let homeless = [];

  kept.find({}, { online_ordering: 1 }).forEach((row) => {
    if (!row.online_ordering) return;
    const answer = db.branches.updateOne(
      { _id: row._id },
      { $set: { online_ordering: row.online_ordering } }
    );
    if (answer.matchedCount) put += 1;
    else homeless.push(row);
  });

  print('keep-branches: put back ' + put + ', no longer present ' + homeless.length);

  if (homeless.length && shopNow) {
    /*
     * The shop was rebuilt. Move the configuration and the settings onto the
     * one that exists now, so a key typed yesterday is still a key today.
     */
    const from = homeless[0];
    db.branches.updateOne(
      { _id: shopNow._id },
      { $set: { online_ordering: Object.assign({}, from.online_ordering, { branch_id: shopNow._id }) } }
    );

    for (const name of ['branch_secrets', 'branch_preferences']) {
      const rows = db.getCollection(name);
      if (!rows || rows.countDocuments() === 0) continue;
      /* An account row belongs to the licence, not to a branch, so it keeps
         its null branch and takes the new licence only. */
      rows.updateMany({ branch_id: null }, { $set: { license: shopNow.license } });
      rows.updateMany(
        { branch_id: { $ne: null } },
        { $set: { license: shopNow.license, branch_id: shopNow._id } }
      );
    }
    print(
      'keep-branches: the shop was rebuilt, so the configuration and the saved' +
        ' settings were re-homed onto ' +
        (shopNow.branch_name || shopNow._id)
    );
  } else if (homeless.length) {
    print(
      'keep-branches: ' +
        homeless.length +
        ' kept branch(es) have no home and there is not exactly one shop to' +
        ' give them to - left alone rather than guessed at'
    );
  }
}

/* The working copy is not part of the sandbox's data and must not be left
   lying in it, where the next dump would carry it into the seed. */
db.kept_branches.drop();
