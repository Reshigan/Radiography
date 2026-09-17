import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Sheet, Field, Input, Select } from '@bonakala/bdl';
import { api, ApiError } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/sites')({ component: SitesPage });

interface Site { id: string; practiceId: string; code: string; name: string; address: string | null; province: string | null; phone: string | null; status: string }
interface Room { id: string; name: string; roomType: string; licenceNo: string | null; licenceExpiry: string | null; status: string; modalities: Array<{ id: string; type: string; vendor: string | null; model: string | null; serial: string | null; aeTitle: string | null; status: string; lastQaAt: string | null; nextQaDue: string | null }> }

function SitesPage() {
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState('');
  const [createSite, setCreateSite] = useState(false);
  const [editSite, setEditSite] = useState<Site | null>(null);
  const [createRoom, setCreateRoom] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [addModality, setAddModality] = useState<Room | null>(null);

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Site[] }>('/org/sites') });
  const selected = siteId || sites.data?.sites[0]?.id || '';
  const rooms = useQuery({ queryKey: ['rooms', selected], enabled: !!selected, queryFn: () => api.get<{ rooms: Room[] }>(`/org/sites/${selected}/rooms`) });
  const licences = useQuery({ queryKey: ['licences'], queryFn: () => api.get<{ licences: Array<{ roomId: string; room: string; site: string; licenceNo: string | null; expiry: string | null; daysToExpiry: number | null }> }>('/org/licences') });

  const expiring = (licences.data?.licences ?? []).filter((l) => l.daysToExpiry !== null && l.daysToExpiry < 90);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['sites'] }); void qc.invalidateQueries({ queryKey: ['rooms'] }); void qc.invalidateQueries({ queryKey: ['licences'] }); };

  return (
    <AdminShell
      active="/admin/sites"
      title="Sites and rooms"
      subtitle={`${sites.data?.sites.length ?? 0} sites · licences, modalities and AE titles`}
      actions={
        <>
          <select value={selected} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" className="btn">
            {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button variant="primary" onClick={() => setCreateSite(true)}>New site</Button>
        </>
      }
    >
      {expiring.length > 0 && <Banner kind="warn">{expiring.map((l) => `${l.site} ${l.room}: licence expires ${l.expiry} (${l.daysToExpiry} days)`).join(' · ')}. A room is blocked for scheduling from the expiry date.</Banner>}
      {sites.isError && <Banner kind="crit">Sites could not be loaded. Refresh, or call platform support with reference org-sites.</Banner>}

      <Card title="Sites">
        {sites.isLoading ? <Skeleton rows={4} /> : !sites.data?.sites.length ? <EmptyState>No sites registered.</EmptyState> : (
          <DataTable
            rows={sites.data.sites}
            rowKey={(s) => s.id}
            selectedKey={selected}
            onRowClick={(s) => { setSiteId(s.id); setEditSite(s); }}
            columns={[
              { key: 'code', header: 'Code', render: (s) => <span className="mono">{s.code}</span> },
              { key: 'name', header: 'Site', render: (s) => <b>{s.name}</b> },
              { key: 'address', header: 'Address', render: (s) => <span className="small">{s.address ?? '—'}</span> },
              { key: 'province', header: 'Province', render: (s) => s.province ?? '—' },
              { key: 'phone', header: 'Phone', render: (s) => <span className="mono small">{s.phone ?? '—'}</span> },
              { key: 'status', header: 'Status', render: (s) => <StatusChip status={s.status} /> },
            ]}
          />
        )}
      </Card>

      <Card title="Rooms, modalities and licences" extra={<><span className="small muted">{sites.data?.sites.find((s) => s.id === selected)?.name}</span> <Button size="sm" disabled={!selected} onClick={() => setCreateRoom(true)}>New room</Button></>}>
        {rooms.isLoading ? <Skeleton rows={5} /> : !rooms.data?.rooms.length ? <EmptyState>No rooms at this site.</EmptyState> : (
          <DataTable
            rows={rooms.data.rooms}
            rowKey={(r) => r.id}
            onRowClick={(r) => setEditRoom(r)}
            columns={[
              { key: 'room', header: 'Room', render: (r) => <><b>{r.name}</b><div className="small muted">{r.roomType}</div></> },
              { key: 'licence', header: 'Licence', render: (r) => r.licenceNo ? <span className="mono small">{r.licenceNo}</span> : <span className="muted small">not ionising</span> },
              { key: 'expiry', header: 'Expiry', render: (r) => r.licenceExpiry ? <span className="mono small">{r.licenceExpiry}</span> : <span className="muted">—</span> },
              { key: 'device', header: 'Modality', render: (r) => r.modalities[0] ? <>{r.modalities[0]!.vendor} {r.modalities[0]!.model}<div className="small muted mono">SN {r.modalities[0]!.serial ?? '—'}</div></> : <span className="muted">none</span> },
              { key: 'ae', header: 'AE title', render: (r) => r.modalities[0]?.aeTitle ? <span className="mono small">{r.modalities[0]!.aeTitle}</span> : <span className="muted">—</span> },
              { key: 'qa', header: 'QA', render: (r) => r.modalities[0] ? <span className="small mono">last {r.modalities[0]!.lastQaAt ?? '—'} · next {r.modalities[0]!.nextQaDue ?? '—'}</span> : <span className="muted">—</span> },
              { key: 'status', header: 'Device', render: (r) => r.modalities[0] ? <StatusChip status={r.modalities[0]!.status} /> : <span className="muted">—</span> },
            ]}
          />
        )}
        <p className="note">A modality may not move to in service until acceptance testing evidence and, for ionising units, the room licence are attached and verified by compliance.</p>
      </Card>

      <Card title="Licence register" extra={<Chip kind={expiring.length ? 'att' : 'done'}>{expiring.length} within 90 days</Chip>}>
        {licences.isLoading ? <Skeleton rows={4} /> : (
          <DataTable
            rows={licences.data?.licences ?? []}
            rowKey={(l) => l.roomId}
            columns={[
              { key: 'site', header: 'Site', render: (l) => l.site },
              { key: 'room', header: 'Room', render: (l) => l.room },
              { key: 'no', header: 'Licence', render: (l) => <span className="mono small">{l.licenceNo ?? '—'}</span> },
              { key: 'expiry', header: 'Expiry', render: (l) => <span className="mono small">{l.expiry ?? '—'}</span> },
              { key: 'days', header: 'Days', num: true, render: (l) => l.daysToExpiry === null ? <span className="muted">—</span> : <Chip kind={l.daysToExpiry < 30 ? 'crit' : l.daysToExpiry < 90 ? 'att' : 'done'}>{l.daysToExpiry}</Chip> },
            ]}
          />
        )}
      </Card>

      {createSite && <SiteSheet title="New site" onClose={() => setCreateSite(false)} onSave={(data) => api.post('/org/sites', data)} onSaved={() => { setCreateSite(false); invalidate(); }} />}
      {editSite && <SiteSheet title={editSite.name} initial={editSite} onClose={() => setEditSite(null)} onSave={(data) => api.patch(`/org/sites/${editSite.id}`, data)} onSaved={() => { setEditSite(null); invalidate(); }} />}
      {createRoom && selected && <RoomSheet title="New room" onClose={() => setCreateRoom(false)} onSave={(data) => api.post(`/org/sites/${selected}/rooms`, data)} onSaved={() => { setCreateRoom(false); invalidate(); }} />}
      {editRoom && (
        <RoomSheet
          title={editRoom.name}
          initial={editRoom}
          onClose={() => setEditRoom(null)}
          onSave={(data) => api.patch(`/org/rooms/${editRoom.id}`, data)}
          onSaved={() => { setEditRoom(null); invalidate(); }}
          extra={editRoom.modalities.length ? undefined : <Button size="sm" onClick={() => setAddModality(editRoom)}>Add modality</Button>}
        />
      )}
      {addModality && <ModalitySheet room={addModality} onClose={() => setAddModality(null)} onSaved={() => { setAddModality(null); setEditRoom(null); invalidate(); }} />}
    </AdminShell>
  );
}

function SiteSheet({ title, initial, onClose, onSave, onSaved }: { title: string; initial?: Site; onClose: () => void; onSave: (data: Record<string, unknown>) => Promise<unknown>; onSaved: () => void }) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [province, setProvince] = useState(initial?.province ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => onSave(initial ? { name, address, province, phone, status } : { code, name, address, province }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the site'),
  });
  return (
    <Sheet open onClose={onClose} title={title}>
      {error && <Banner kind="crit">{error}</Banner>}
      {!initial && <Field label="Code" hint="2-4 letters, e.g. UMH"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} /></Field>}
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <Field label="Province"><Input value={province} onChange={(e) => setProvince(e.target.value)} /></Field>
      {initial && <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>}
      {initial && (
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      )}
      <div className="row-flex">
        <Button variant="primary" disabled={!name || (!initial && code.length < 2) || save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
      </div>
    </Sheet>
  );
}

function RoomSheet({ title, initial, extra, onClose, onSave, onSaved }: { title: string; initial?: Room; extra?: ReactNode; onClose: () => void; onSave: (data: Record<string, unknown>) => Promise<unknown>; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [roomType, setRoomType] = useState(initial?.roomType ?? 'XR');
  const [licenceNo, setLicenceNo] = useState(initial?.licenceNo ?? '');
  const [licenceExpiry, setLicenceExpiry] = useState(initial?.licenceExpiry ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => onSave(initial ? { name, licenceNo: licenceNo || null, licenceExpiry: licenceExpiry || null } : { name, roomType, licenceNo: licenceNo || undefined, licenceExpiry: licenceExpiry || undefined }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the room'),
  });
  return (
    <Sheet open onClose={onClose} title={title}>
      {error && <Banner kind="crit">{error}</Banner>}
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CT 1" /></Field>
      {!initial && (
        <Field label="Room type">
          <Select value={roomType} onChange={(e) => setRoomType(e.target.value)}>
            {['XR', 'CT', 'MR', 'US', 'MG', 'RF', 'DXA', 'PX'].map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Licence number" hint="Ionising rooms only"><Input value={licenceNo} onChange={(e) => setLicenceNo(e.target.value)} /></Field>
      <Field label="Licence expiry"><Input type="date" value={licenceExpiry} onChange={(e) => setLicenceExpiry(e.target.value)} /></Field>
      <div className="row-flex">
        <Button variant="primary" disabled={!name || save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
        {extra}
      </div>
    </Sheet>
  );
}

function ModalitySheet({ room, onClose, onSaved }: { room: Room; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState('DX');
  const [vendor, setVendor] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [aeTitle, setAeTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post(`/org/rooms/${room.id}/modalities`, { type, vendor: vendor || undefined, model: model || undefined, serial: serial || undefined, aeTitle: aeTitle || undefined }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the modality'),
  });
  return (
    <Sheet open onClose={onClose} title={`Add modality · ${room.name}`}>
      {error && <Banner kind="crit">{error}</Banner>}
      <Field label="Type">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {['DX', 'CR', 'CT', 'MR', 'US', 'MG', 'RF', 'DXA', 'PX', 'NM'].map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
      <Field label="Vendor"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
      <Field label="Model"><Input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      <Field label="Serial number"><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
      <Field label="AE title"><Input value={aeTitle} onChange={(e) => setAeTitle(e.target.value.toUpperCase())} /></Field>
      <div className="row-flex">
        <Button variant="primary" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
      </div>
      <p className="note">A modality is created in acceptance-pending state; move it to in service from the licence register once QA evidence is attached.</p>
    </Sheet>
  );
}
