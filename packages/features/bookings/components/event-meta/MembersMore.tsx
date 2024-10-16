import { SchedulingType } from "@calcom/prisma/enums";
import { UserAvatarGroup, UserAvatarGroupWithOrg } from "@calcom/ui";

import type { PublicEvent } from "../../types";

export interface EventMembersProps {
  /**
   * Used to determine whether all members should be shown or not.
   * In case of Round Robin type, members aren't shown.
   */
  schedulingType: PublicEvent["schedulingType"];
  users: PublicEvent["users"];
  profile: PublicEvent["profile"];
  entity: PublicEvent["entity"];
}

export const EventMembersMore = ({ schedulingType, users, profile, entity }: EventMembersProps) => {
  const showMembers = schedulingType !== SchedulingType.ROUND_ROBIN;
  const shownUsers = showMembers ? users : [];

  // In some cases we don't show the user's names, but only show the profile name.
  const showOnlyProfileName =
    (profile.name && schedulingType === SchedulingType.ROUND_ROBIN) ||
    !users.length ||
    (profile.name !== users[0].name && schedulingType === SchedulingType.COLLECTIVE);

  return (
    <>
      {entity.orgSlug ? (
        <UserAvatarGroupWithOrg
          size="sm"
          className="border-muted flex justify-center"
          organization={{
            slug: entity.orgSlug,
            name: entity.name || "",
          }}
          users={shownUsers}
        />
      ) : (
        <UserAvatarGroup size="sm" className="border-muted flex justify-center" users={shownUsers} />
      )}

      <p className="text-subtle mt-2 text-center text-sm font-semibold">
        {showOnlyProfileName
          ? profile.name
          : shownUsers
              .map((user) => user.name)
              .filter((name) => name)
              .join(", ")}
      </p>
    </>
  );
};
