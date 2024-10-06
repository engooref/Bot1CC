# Import Module 
from win32com import client 
  
# Open Microsoft Excel 
excel = client.Dispatch("Excel.Application") 
  
# Read Excel File 
sheets = excel.Workbooks.Open("C:\\Users\\arman\\OneDrive\\Bureau\\Projet\\Bot1CC\\Affectation et Formations.xlsx") 
work_sheets = sheets.Worksheets(1) 
  
  # Configurer l'orientation de la page en paysage
work_sheets.PageSetup.Orientation = 2  # 2 correspond à l'orientation paysage (xlLandscape)

  # Configurer la mise en page pour adapter la feuille à une seule page
work_sheets.PageSetup.Zoom = False  # Désactiver le zoom pour utiliser FitToPages
work_sheets.PageSetup.FitToPagesWide = 1  # Ajuster pour tenir en 1 page de largeur
work_sheets.PageSetup.FitToPagesTall = 1  # Ajuster pour tenir en 1 page de hauteur

work_sheets.PageSetup.LeftMargin = 0
work_sheets.PageSetup.RightMargin = 0
work_sheets.PageSetup.TopMargin = 0
work_sheets.PageSetup.BottomMargin = 0

work_sheets.PageSetup.PrintArea = "A1:O31"
# Convert into PDF File 
work_sheets.ExportAsFixedFormat(0, "C:\\Users\\arman\\OneDrive\\Bureau\\Projet\\Bot1CC\\test.pdf") 

# Fermer le classeur sans enregistrer les modifications
sheets.Close(False)

# Quitter Excel
excel.Quit()