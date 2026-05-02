import { PrismaClient, Role, EquipmentType, EquipmentStatus, Frequency } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Empresa
  const company = await prisma.company.upsert({
    where: { id: 'company-1' },
    update: {},
    create: {
      id: 'company-1',
      name: 'Mi Empresa S.A.S.',
      nit: '900.123.456-7',
      address: 'Calle 100 # 15-20, Bogotá',
      phone: '601-234-5678',
      email: 'contacto@miempresa.com',
    },
  });

  // Sucursales
  const branchMain = await prisma.branch.upsert({
    where: { id: 'branch-main' },
    update: {},
    create: {
      id: 'branch-main',
      companyId: company.id,
      name: 'Sede Principal',
      city: 'Bogotá',
      address: 'Calle 100 # 15-20',
      phone: '601-234-5678',
    },
  });

  const branchNorth = await prisma.branch.upsert({
    where: { id: 'branch-north' },
    update: {},
    create: {
      id: 'branch-north',
      companyId: company.id,
      name: 'Sede Norte',
      city: 'Bogotá',
      address: 'Cra 15 # 120-30',
      phone: '601-234-5679',
    },
  });

  // Ubicaciones
  const locMain = await prisma.location.upsert({
    where: { id: 'loc-main-1' },
    update: {},
    create: {
      id: 'loc-main-1',
      branchId: branchMain.id,
      building: 'Bloque A',
      floor: 'Piso 1',
      area: 'Taller de Mantenimiento',
    },
  });

  const locNorth = await prisma.location.upsert({
    where: { id: 'loc-north-1' },
    update: {},
    create: {
      id: 'loc-north-1',
      branchId: branchNorth.id,
      floor: 'Piso 2',
      area: 'Área de Producción',
    },
  });

  // Usuarios
  const adminPass = await bcrypt.hash('admin123', 12);
  const techPass = await bcrypt.hash('tech123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@miempresa.com' },
    update: {},
    create: {
      email: 'admin@miempresa.com',
      name: 'Administrador',
      password: adminPass,
      role: Role.ADMIN,
      branchId: branchMain.id,
    },
  });

  const chief = await prisma.user.upsert({
    where: { email: 'jefe@miempresa.com' },
    update: {},
    create: {
      email: 'jefe@miempresa.com',
      name: 'Jefe de Mantenimiento',
      password: await bcrypt.hash('jefe123', 12),
      role: Role.MAINTENANCE_CHIEF,
      branchId: branchMain.id,
    },
  });

  const tech = await prisma.user.upsert({
    where: { email: 'tecnico@miempresa.com' },
    update: {},
    create: {
      email: 'tecnico@miempresa.com',
      name: 'Técnico Principal',
      password: techPass,
      role: Role.TECHNICIAN,
      branchId: branchMain.id,
    },
  });

  // Equipos de ejemplo
  const eq1 = await prisma.equipment.upsert({
    where: { code: 'EQ-001' },
    update: {},
    create: {
      code: 'EQ-001',
      qrCode: `${process.env.BASE_URL || 'http://localhost:3001'}/equipo/EQ-001/acceso`,
      name: 'Compresor de Aire Industrial',
      serialNumber: 'SN-2021-ABC',
      model: 'CA-500',
      brand: 'Atlas Copco',
      year: 2021,
      type: EquipmentType.GENERAL,
      category: 'Neumático',
      subcategory: 'Compresor',
      status: EquipmentStatus.ACTIVE,
      locationId: locMain.id,
      assetNumber: 'AF-0001',
      purchaseValue: 15000000,
    },
  });

  const eq2 = await prisma.equipment.upsert({
    where: { code: 'EQ-002' },
    update: {},
    create: {
      code: 'EQ-002',
      qrCode: `${process.env.BASE_URL || 'http://localhost:3001'}/equipo/EQ-002/acceso`,
      name: 'Monitor de Signos Vitales',
      serialNumber: 'SN-2022-XYZ',
      model: 'ProCare 5000',
      brand: 'Mindray',
      year: 2022,
      type: EquipmentType.BIOMEDICAL,
      category: 'Diagnóstico',
      subcategory: 'Monitoreo',
      status: EquipmentStatus.ACTIVE,
      locationId: locNorth.id,
      assetNumber: 'AF-0002',
      purchaseValue: 25000000,
    },
  });

  // Proveedor de ejemplo
  const provider = await prisma.provider.upsert({
    where: { id: 'provider-1' },
    update: {},
    create: {
      id: 'provider-1',
      nit: '800.456.789-1',
      name: 'Tecniservicio S.A.S.',
      contact: 'Juan Pérez',
      email: 'contacto@tecniservicio.com',
      phone: '300-123-4567',
      specialty: 'Equipos industriales y biomédicos',
      city: 'Bogotá',
    },
  });

  // Plan de mantenimiento preventivo de ejemplo
  await prisma.maintenancePlan.upsert({
    where: { id: 'plan-1' },
    update: {},
    create: {
      id: 'plan-1',
      equipmentId: eq1.id,
      name: 'Mantenimiento preventivo trimestral',
      frequency: Frequency.QUARTERLY,
      nextDueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 días
      alertDaysBefore: 7,
      estimatedHours: 4,
      checklistTemplate: [
        { id: '1', item: 'Verificar nivel de aceite', required: true },
        { id: '2', item: 'Limpiar filtros de aire', required: true },
        { id: '3', item: 'Verificar presión de trabajo', required: true },
        { id: '4', item: 'Revisar correas y poleas', required: false },
        { id: '5', item: 'Comprobar manómetros', required: true },
      ],
      assignedToUserId: tech.id,
    },
  });

  // Repuestos de ejemplo
  const part1 = await prisma.sparePart.upsert({
    where: { code: 'REP-001' },
    update: {},
    create: {
      code: 'REP-001',
      name: 'Filtro de aire industrial',
      description: 'Filtro para compresor Atlas Copco CA-500',
      unit: 'Unidad',
      category: 'Filtros',
      providerId: provider.id,
    },
  });

  const part2 = await prisma.sparePart.upsert({
    where: { code: 'REP-002' },
    update: {},
    create: {
      code: 'REP-002',
      name: 'Aceite hidráulico ISO 46',
      unit: 'Litro',
      category: 'Lubricantes',
    },
  });

  // Stock inicial
  await prisma.sparePartStock.upsert({
    where: { sparePartId_branchId: { sparePartId: part1.id, branchId: branchMain.id } },
    update: {},
    create: { sparePartId: part1.id, branchId: branchMain.id, quantity: 10, minStock: 3 },
  });

  await prisma.sparePartStock.upsert({
    where: { sparePartId_branchId: { sparePartId: part2.id, branchId: branchMain.id } },
    update: {},
    create: { sparePartId: part2.id, branchId: branchMain.id, quantity: 20, minStock: 5 },
  });

  console.log('✅ Seed completado');
  console.log('\n📋 Credenciales de acceso:');
  console.log('  Admin:   admin@miempresa.com / admin123');
  console.log('  Jefe:    jefe@miempresa.com  / jefe123');
  console.log('  Técnico: tecnico@miempresa.com / tech123\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
