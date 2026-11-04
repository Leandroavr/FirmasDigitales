db.contracts_Users.updateOne({_id: "AVG3ssTr1q"}, {$set: {HierarchyLevel: "Gerencia", JobTitle: "Gerente de Informática", Department: "Gerencia de Informática"}});
db.contracts_Users.updateOne({_id: "F6KaJOmPfo"}, {$set: {HierarchyLevel: "Jefatura de Grupo", ReportsTo: "AVG3ssTr1q", JobTitle: "Jefe de Grupo Sistemas", Department: "Gerencia de Informática"}});
db.contracts_Users.updateOne({_id: "cdbvggXihd"}, {$set: {HierarchyLevel: "Especialista / Base", ReportsTo: "F6KaJOmPfo", JobTitle: "Especialista B en ciencias informáticas", Department: "Gerencia de Informática"}});
db.contracts_Users.updateOne({_id: "OVWLX6uMtt"}, {$set: {HierarchyLevel: "Especialista / Base", ReportsTo: "F6KaJOmPfo", JobTitle: "Especialista de Sistemas", Department: "Gerencia de Informática"}});
db.contracts_Users.updateOne({_id: "XmqJziMdfR"}, {$set: {HierarchyLevel: "Especialista / Base", JobTitle: "Especialista de Calidad", Department: "Dirección de Calidad"}});

db.contracts_Contactbook.updateOne({Email: "conrado.peraza@brascuba.cu"}, {$set: {HierarchyLevel: "Gerencia", JobTitle: "Gerente de Informática", Department: "Gerencia de Informática"}});
db.contracts_Contactbook.updateOne({Email: "ubalquis.montenegro@brascuba.cu"}, {$set: {HierarchyLevel: "Jefatura de Grupo", ReportsTo: "AVG3ssTr1q", JobTitle: "Jefe de Grupo Sistemas", Department: "Gerencia de Informática"}});
db.contracts_Contactbook.updateOne({Email: "leandro.valdes@brascuba.cu"}, {$set: {HierarchyLevel: "Especialista / Base", ReportsTo: "F6KaJOmPfo", JobTitle: "Especialista B en ciencias informáticas", Department: "Gerencia de Informática"}});
db.contracts_Contactbook.updateOne({Email: "frank.alvarez@brascuba.cu"}, {$set: {HierarchyLevel: "Especialista / Base", ReportsTo: "F6KaJOmPfo", JobTitle: "Especialista de Sistemas", Department: "Gerencia de Informática"}});
db.contracts_Contactbook.updateOne({Email: "dania.ramirez@brascuba.cu"}, {$set: {HierarchyLevel: "Especialista / Base", JobTitle: "Especialista de Calidad", Department: "Dirección de Calidad"}});
print("Hierarchy successfully seeded in MongoDB!");
