import React from 'react';
import MDXComponents from '@theme-original/MDXComponents';
import DateBadge from '@site/src/components/DateBadge';
import DomainBadge from '@site/src/components/DomainBadge';
import PriorityBadge from '@site/src/components/PriorityBadge';
import SeverityBadge from '@site/src/components/SeverityBadge';
import StatusBadge from '@site/src/components/StatusBadge';
import RFCLevelBadge from '@site/src/components/RFCLevelBadge';
import RequirementBox from '@site/src/components/RequirementBox';
import Field from '@site/src/components/Field';
import FieldGroup from '@site/src/components/FieldGroup';
import SkillTile from '@site/src/components/SkillTile';

export default {
  ...MDXComponents,
  DateBadge,
  DomainBadge,
  PriorityBadge,
  SeverityBadge,
  StatusBadge,
  RFCLevelBadge,
  RequirementBox,
  Field,
  FieldGroup,
  // Governing: ADR-0029, SPEC-0021 REQ "Hero-Tile Index Page".
  SkillTile,
};
