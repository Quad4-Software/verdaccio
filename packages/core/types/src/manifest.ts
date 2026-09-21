export interface PackageAccess {
  storage?: string;
  publish?: string[];
  proxy?: string[];
  access?: string[];
  unpublish?: string[] | boolean; // false means fallback to publish access
  stage?: string[] | boolean; // false means fallback to publish access
  // when set, users outside these groups cannot even see the package exists (reads 404)
  visibility?: string[];
}

export interface PackageList {
  [key: string]: PackageAccess;
}

export interface MergeTags {
  [key: string]: string;
}

export interface DistFile {
  url: string;
  sha: string;
  registry?: string;
}

export interface DistFiles {
  [key: string]: DistFile;
}

export interface Token {
  user: string;
  token: string;
  key: string;
  cidr?: string[];
  readonly: boolean;
  // minimatch patterns limiting which packages the token may touch
  packages?: string[];
  created: number | string;
  updated?: number | string;
}

export interface AttachMents {
  [key: string]: AttachMentsItem;
}

export interface AttachMentsItem {
  content_type?: string;
  data?: string;
  length?: number;
  shasum?: string;
  version?: string;
}

export interface GenericBody {
  [key: string]: string;
}

export interface UpLinkMetadata {
  etag: string;
  fetched: number;
}

export interface UpLinks {
  [key: string]: UpLinkMetadata;
}

export interface Signatures {
  keyid: string;
  sig: string;
}

export interface Dist {
  'npm-signature'?: string;
  signatures?: Signatures[];
  /**
   * npm provenance attestation pointers. The registry only advertises the URL
   * of the attestation document; the Sigstore bundle itself is stored under
   * `Manifest._attestations` and served from `/-/npm/v1/attestations`.
   */
  attestations?: { url: string; provenance?: { predicateType: string } }[];
  fileCount?: number;
  integrity?: string;
  shasum: string;
  unpackedSize?: number;
  tarball: string;
}

export interface Author {
  username?: string;
  name: string;
  email?: string;
  url?: string;
  _avatar?: string; // for web ui
}

export type Person = Author | string;

export interface PackageUsers {
  [key: string]: boolean;
}

export interface Tags {
  [key: string]: Version;
}

export interface PeerDependenciesMeta {
  [dependencyName: string]: {
    optional?: boolean;
  };
}

export interface Version {
  name: string;
  version: string;
  directories?: any;
  dist: Dist;
  author: Person;
  main: string;
  homemage?: string;
  license?: string;
  readme: string;
  readmeFileName?: string;
  readmeFilename?: string;
  description: string;
  bin?: string;
  bugs?: any;
  files?: string[];
  gitHead?: string;
  maintainers?: Person[];
  contributors?: Person[];
  repository?: string | any;
  scripts?: any;
  homepage?: string;
  etag?: string;
  dependencies?: Dependencies;
  peerDependencies?: Dependencies;
  devDependencies?: Dependencies;
  optionalDependencies?: Dependencies;
  peerDependenciesMeta?: PeerDependenciesMeta;
  bundleDependencies?: string[];
  acceptDependencies?: Dependencies;
  keywords?: string | string[];
  nodeVersion?: string;
  _id: string;
  _npmVersion?: string;
  _npmUser: Author;
  _hasShrinkwrap?: boolean;
  deprecated?: string;
  funding?: { type: string; url: string };
  engines?: Engines;
  hasInstallScript?: boolean;
  cpu?: string[];
  os?: string[];
  /** result of the publish-time scan, when `scan.enabled` is set */
  scan?: PackageScanResult;
  // packument-level flag surfaced on list summaries
  visibility?: string;
}

export interface PackageScanFinding {
  type: 'license' | 'install-script' | 'native-code' | 'osv' | 'quota' | 'policy';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface PackageScanResult {
  status: 'pass' | 'warn' | 'fail';
  findings: PackageScanFinding[];
  at: string;
}

/**
 * A Sigstore attestation bundle as uploaded by `npm publish --provenance`.
 * `predicateType` is extracted from the DSSE payload so the registry can
 * advertise it in `dist.attestations` without parsing on every read.
 */
export interface RegistryAttestation {
  predicateType: string;
  bundle: Record<string, any>;
}

export interface Dependencies {
  [key: string]: string;
}

export interface Engines {
  [key: string]: string;
}

export interface Versions {
  [key: string]: Version;
}

/**
 * @deprecated use Manifest instead
 */
export interface Package {
  _id?: string;
  name: string;
  versions: Versions;
  'dist-tags': GenericBody;
  time: GenericBody;
  readme?: string;
  users?: PackageUsers;
  _distfiles: DistFiles;
  _attachments: AttachMents;
  _uplinks: UpLinks;
  _rev: string;
}

/**
 * Represents upstream manifest from another registry
 */
export interface FullRemoteManifest {
  _id?: string;
  _rev?: string;
  name: string;
  description?: string;
  'dist-tags': GenericBody;
  time: GenericBody;
  versions: Versions;
  /** store owners of this package */
  maintainers?: Person[];
  contributors?: Person[];
  /** store the latest readme **/
  readme?: string;
  /** store star assigned to this packages by users */
  users?: PackageUsers;
  // TODO: not clear what access exactly means
  access?: any;
  bugs?: { url: string };
  license?: string;
  homepage?: string;
  repository?: string | { type?: string; url: string; directory?: string };
  keywords?: string[];
  author?: Person;
}

export interface Manifest extends FullRemoteManifest, PublishManifest {
  // private fields only used by verdaccio
  /**
   * store fast access to the dist url of an specific tarball, instead search version
   * by id, just the tarball id is faster.
   *
   * The _distfiles is created only when a package is being sync from an upstream.
   * also used to fetch tarballs from upstream, the private publish tarballs are not stored in
   * this object because they are not published in the upstream registry.
   */
  _distfiles: DistFiles;
  /**
   * Store access cache metadata, to avoid to fetch the same metadata multiple times.
   *
   * The key represents the uplink id which is composed of a etag and a fetched timestamp.
   *
   * The fetched timestamp is the time when the metadata was fetched, used to avoid to fetch the
   * same metadata until the metadata is older than the last fetch.
   */
  _uplinks: UpLinks;
  /**
   * store the revision of the manifest
   */
  _rev: string;
  /**
   * private packages are only visible to users allowed to publish them
   */
  visibility?: 'private' | 'public';
  /**
   * Per-package collaborator grants (`npm access`-style). Maps a username to
   * `read` or `write`; `write` also implies publish/unpublish. Internal field,
   * stripped from packument responses (not part of the WHITELIST).
   */
  collaborators?: Record<string, 'read' | 'write'>;
  /**
   * `npm access set mfa=publish|automation`: when true, publishes and metadata
   * writes to this package require a one-time password from TFA-enabled users.
   */
  publish_requires_tfa?: boolean;
  /**
   * Whether automation tokens may bypass `publish_requires_tfa` for this
   * package (npm `mfa=automation`).
   */
  automation_token_overrides_tfa?: boolean;
  /**
   * Sigstore attestation bundles uploaded with `npm publish --provenance`,
   * keyed by version. Internal field, stripped from packument responses.
   */
  _attestations?: Record<string, RegistryAttestation[]>;
}

export type AbbreviatedVersion = Pick<
  Version,
  | 'name'
  | 'version'
  | 'dependencies'
  | 'devDependencies'
  | 'bin'
  | 'dist'
  | 'engines'
  | 'funding'
  | 'peerDependencies'
  | 'cpu'
  | 'deprecated'
  | 'directories'
  | 'hasInstallScript'
  | 'optionalDependencies'
  | 'os'
  | 'peerDependenciesMeta'
  | 'acceptDependencies'
  | '_hasShrinkwrap'
>;

export interface AbbreviatedVersions {
  [key: string]: AbbreviatedVersion;
}
/**
 *
 */
export type AbbreviatedManifest = Pick<Manifest, 'name' | 'dist-tags' | 'time'> & {
  modified: string;
  versions: AbbreviatedVersions;
};

/**
 *
 */
export type UnPublishManifest = Omit<Manifest, '_attachments' | '_distfiles' | '_uplinks'>;

export interface Publisher {
  name: string;
  groups?: string[];
  real_groups?: string[];
}

export interface PublishManifest {
  /**
   * The `_attachments` object has different usages:
   *
   * - When a package is published, it contains the tarball as an string, this string is used to be
   * converted as a tarball, usually attached to the package but not stored in the database.
   * - If user runs `npm star` the _attachments will be at the manifest body but empty.
   *
   * It has also an internal usage:
   *
   * - Used as a cache for the tarball, quick access to the tarball shasum, etc. Instead
   * iterate versions and find the right one, just using the tarball as a key which is what
   * the package manager sends to the registry.
   *
   * - A `_attachments` object is added every time a private tarball is published, upstream cached tarballs are
   * not being part of this object, only for published private packages.
   *
   * Note: This field is removed when the package is accesed through the web user interface.
   * */
  _attachments: AttachMents;
  /**
   * The publisher of the package
   *
   * This field is added when the package is published or unpublished using the notify batch service.
   *
   * Note: Using `_publisher` or `_publishedPackage` would break existing handlebar templates.
   */
  publisher?: Publisher;
  publishedPackage?: string;
  /**
   * Which event triggered the notification.
   *
   * - `publish` / `unpublish`: a version became installable, or stopped being so.
   *   Approving a staged version reports `publish`, because that is what it does.
   * - `stage` / `unstage`: a version was submitted for review, or that submission
   *   was discarded. Neither changes what is installable.
   */
  publishType?: 'publish' | 'unpublish' | 'stage' | 'unstage';
}

/**
 * Web user interface hoists the selected version to "latest" and adds "dist.tarball" field.
 */
export interface WebManifest extends Manifest {
  latest?: Version;
  dist?: { tarball: string };
}
