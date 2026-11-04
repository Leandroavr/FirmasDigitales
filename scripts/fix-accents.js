db.contracts_Users.updateMany({Department: /Inform/i}, {$set: {Department: "Gerencia de Inform\u00e1tica"}});
db.contracts_Users.updateMany({Department: /Direcci/i}, {$set: {Department: "Direcci\u00f3n de Calidad"}});
db.contracts_Users.updateOne({_id: "AVG3ssTr1q"}, {$set: {JobTitle: "Gerente de Inform\u00e1tica"}});
db.contracts_Users.updateOne({_id: "cdbvggXihd"}, {$set: {JobTitle: "Especialista B en ciencias inform\u00e1ticas"}});

db.contracts_Contactbook.updateMany({Department: /Inform/i}, {$set: {Department: "Gerencia de Inform\u00e1tica"}});
db.contracts_Contactbook.updateMany({Department: /Direcci/i}, {$set: {Department: "Direcci\u00f3n de Calidad"}});
db.contracts_Contactbook.updateOne({Email: "conrado.peraza@brascuba.cu"}, {$set: {JobTitle: "Gerente de Inform\u00e1tica"}});
db.contracts_Contactbook.updateOne({Email: "leandro.valdes@brascuba.cu"}, {$set: {JobTitle: "Especialista B en ciencias inform\u00e1ticas"}});
print("Accents successfully fixed!");
